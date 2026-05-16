/**
 * Host-side HTTP proxy bridge → `adb reverse` → Android global `http_proxy` pointing at the reversed port.
 * Upstream must be an **HTTP proxy** (Basic auth + CONNECT tunneling). SOCKS5-only rows are not supported on this path.
 */
import http from 'node:http'
import net from 'node:net'

import { db } from '../../db.js'
import {
  deleteGlobalSetting,
  putOrDeleteGlobalSetting,
  readMobileProxyExclusionList,
} from './adbGlobalSettings.js'
import { runAdb } from './adbRunner.js'
import { validateMobileProxyRowForBridge } from './mobileProxyValidation.js'

const MOBILE_PROXY_DEVICE_PORT = 19100
const DEFAULT_PROXY_PROBE_TIMEOUT_MS = 7_000
/** @type {Map<string, { proxyId: string, adbSerial: string, hostPort: number, server: import('node:http').Server }>} */
const activeMobileProxyBridges = new Map()

function emitLog(emit, action, details = '') {
  emit?.(action, String(details ?? '').trim())
}

function proxyAuthHeader(endpoint) {
  const username = String(endpoint.username ?? '').trim()
  const password = String(endpoint.password ?? '').trim()
  if (!username && !password) return ''
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function sanitizeHeadersForUpstream(headers, authHeader) {
  const next = { ...headers }
  delete next['proxy-connection']
  delete next['proxy-authorization']
  delete next.connection
  if (authHeader) next['proxy-authorization'] = authHeader
  return next
}

function absoluteProxyRequestUrl(req) {
  const raw = String(req.url ?? '').trim()
  if (/^https?:\/\//i.test(raw)) return raw
  const host = String(req.headers.host ?? '').trim()
  if (!host) return raw
  return `http://${host}${raw}`
}

function writeSocketError(socket, statusCode, message) {
  if (socket.destroyed) return
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

function readProxyProbeEnabled(env = process.env) {
  const raw = String(env?.MOBILE_PROXY_UPSTREAM_PROBE ?? '1').trim().toLowerCase()
  if (!raw) return true
  return !['0', 'false', 'off', 'no'].includes(raw)
}

function readProxyProbeTimeoutMs(env = process.env) {
  const raw = Number.parseInt(String(env?.MOBILE_PROXY_UPSTREAM_PROBE_TIMEOUT_MS ?? ''), 10)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PROXY_PROBE_TIMEOUT_MS
  return Math.min(raw, 30_000)
}

async function verifyUpstreamHttpProxy(endpoint, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs ?? DEFAULT_PROXY_PROBE_TIMEOUT_MS)
  const authHeader = proxyAuthHeader(endpoint)
  await new Promise((resolve, reject) => {
    let done = false
    const socket = net.connect(Number(endpoint.port), endpoint.host)
    let header = ''
    const finish = (err) => {
      if (done) return
      done = true
      socket.destroy()
      if (err) reject(err)
      else resolve(undefined)
    }

    socket.setTimeout(timeoutMs, () => finish(new Error(`upstream proxy probe timeout after ${timeoutMs}ms`)))
    socket.once('error', (err) =>
      finish(new Error(`failed to connect to proxy ${endpoint.host}:${endpoint.port}: ${err.message}`)),
    )
    socket.once('connect', () => {
      let req = 'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nConnection: close\r\n'
      if (authHeader) req += `Proxy-Authorization: ${authHeader}\r\n`
      req += '\r\n'
      socket.write(req)
    })
    socket.on('data', (chunk) => {
      if (done) return
      header += chunk.toString('utf8')
      const lineEnd = header.indexOf('\r\n')
      if (lineEnd === -1) return
      const statusLine = header.slice(0, lineEnd)
      const match = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})\b/i)
      if (!match) {
        finish(
          new Error(
            `proxy ${endpoint.host}:${endpoint.port} did not return HTTP status line (likely not HTTP proxy)`,
          ),
        )
        return
      }
      const code = Number.parseInt(match[1], 10)
      if (code === 200) {
        finish()
        return
      }
      if (code === 407) {
        finish(new Error(`proxy auth failed for ${endpoint.host}:${endpoint.port} (HTTP 407)`))
        return
      }
      finish(new Error(`proxy CONNECT rejected by ${endpoint.host}:${endpoint.port}: ${statusLine}`))
    })
  })
}

function createProxyBridgeServer(endpoint) {
  const authHeader = proxyAuthHeader(endpoint)
  const server = http.createServer()

  server.on('request', (req, res) => {
    const upstream = http.request({
      host: endpoint.host,
      port: Number(endpoint.port),
      method: req.method,
      path: absoluteProxyRequestUrl(req),
      headers: sanitizeHeadersForUpstream(req.headers, authHeader),
    })

    upstream.on('response', (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage ?? 'Bad Gateway', upstreamRes.headers)
      upstreamRes.pipe(res)
    })
    upstream.on('error', (err) => {
      res.writeHead(502, 'Bad Gateway', { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`proxy bridge error: ${err instanceof Error ? err.message : String(err)}`)
    })
    req.pipe(upstream)
  })

  server.on('connect', (req, clientSocket, head) => {
    const upstreamSocket = net.connect(Number(endpoint.port), endpoint.host)
    let headerBuffer = Buffer.alloc(0)
    let established = false

    upstreamSocket.on('connect', () => {
      let connectRequest = `CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n`
      if (authHeader) connectRequest += `Proxy-Authorization: ${authHeader}\r\n`
      connectRequest += 'Connection: keep-alive\r\n\r\n'
      upstreamSocket.write(connectRequest)
    })

    upstreamSocket.on('data', (chunk) => {
      if (established) return
      headerBuffer = Buffer.concat([headerBuffer, chunk])
      const headerEnd = headerBuffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return

      const headerText = headerBuffer.subarray(0, headerEnd).toString('utf8')
      const statusLine = headerText.split('\r\n')[0] ?? ''
      if (!/HTTP\/1\.[01] 200\b/i.test(statusLine)) {
        writeSocketError(clientSocket, 502, 'Bad Gateway')
        upstreamSocket.destroy()
        return
      }

      established = true
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      const remainder = headerBuffer.subarray(headerEnd + 4)
      if (remainder.length > 0) clientSocket.write(remainder)
      if (head?.length) upstreamSocket.write(head)
      clientSocket.pipe(upstreamSocket)
      upstreamSocket.pipe(clientSocket)
    })

    upstreamSocket.on('error', () => {
      if (!established) writeSocketError(clientSocket, 502, 'Bad Gateway')
    })
    clientSocket.on('error', () => {
      upstreamSocket.destroy()
    })
  })

  server.on('clientError', (err, socket) => {
    writeSocketError(socket, 400, err instanceof Error ? err.message : 'Bad Request')
  })

  return server
}

async function listenProxyBridge(endpoint) {
  const server = createProxyBridgeServer(endpoint)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(undefined)
    })
  })
  const addr = server.address()
  const hostPort =
    addr && typeof addr === 'object' && typeof addr.port === 'number'
      ? addr.port
      : 0
  if (!hostPort) {
    server.close()
    throw new Error('mobile proxy bridge failed to allocate local port')
  }
  return { server, hostPort }
}

function getMobileProxyRow(accountRow) {
  const proxyId = String(accountRow?.mobile_proxy_id ?? '').trim()
  if (!proxyId) return null
  return db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) ?? null
}

async function setAndroidGlobalHttpProxy(adbSerial, port, opts = {}) {
  const exclusionList = readMobileProxyExclusionList(opts.env ?? process.env)
  await putOrDeleteGlobalSetting(adbSerial, 'http_proxy', `127.0.0.1:${port}`, opts)
  await putOrDeleteGlobalSetting(adbSerial, 'global_http_proxy_host', '127.0.0.1', opts)
  await putOrDeleteGlobalSetting(adbSerial, 'global_http_proxy_port', String(port), opts)
  await putOrDeleteGlobalSetting(adbSerial, 'global_http_proxy_exclusion_list', exclusionList, opts)
  // Bridge endpoint inside Android is local and does not require upstream credentials.
  await deleteGlobalSetting(adbSerial, 'global_http_proxy_username', opts).catch(() => {})
  await deleteGlobalSetting(adbSerial, 'global_http_proxy_password', opts).catch(() => {})
}

async function clearAndroidGlobalHttpProxy(adbSerial, opts = {}) {
  await putOrDeleteGlobalSetting(adbSerial, 'http_proxy', ':0', opts).catch(() => {})
  await deleteGlobalSetting(adbSerial, 'global_http_proxy_host', opts).catch(() => {})
  await deleteGlobalSetting(adbSerial, 'global_http_proxy_port', opts).catch(() => {})
  await deleteGlobalSetting(adbSerial, 'global_http_proxy_exclusion_list', opts).catch(() => {})
  await deleteGlobalSetting(adbSerial, 'global_http_proxy_username', opts).catch(() => {})
  await deleteGlobalSetting(adbSerial, 'global_http_proxy_password', opts).catch(() => {})
  await runAdb(adbSerial, ['reverse', '--remove', `tcp:${MOBILE_PROXY_DEVICE_PORT}`], opts).catch(() => {})
}

async function ensureBridge(accountId, adbSerial, proxyRow, opts = {}) {
  const proxyId = String(proxyRow?.id ?? '').trim()
  if (!proxyId) throw new Error('mobile proxy row is missing id')
  const endpoint = validateMobileProxyRowForBridge(proxyRow)
  const runtimeEnv = opts.env ?? process.env

  if (readProxyProbeEnabled(runtimeEnv)) {
    try {
      await verifyUpstreamHttpProxy(endpoint, {
        timeoutMs: readProxyProbeTimeoutMs(runtimeEnv),
      })
      emitLog(
        opts.emit,
        'MOBILE_PROXY_UPSTREAM_OK',
        `proxy=${proxyId} upstream=${endpoint.host}:${endpoint.port}`,
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      emitLog(
        opts.emit,
        'MOBILE_PROXY_UPSTREAM_FAILED',
        `proxy=${proxyId} upstream=${endpoint.host}:${endpoint.port} reason=${reason}`,
      )
      throw err
    }
  }

  const existing = activeMobileProxyBridges.get(String(accountId))
  if (existing && existing.proxyId === proxyId && existing.adbSerial === adbSerial) {
    return existing
  }
  if (existing) {
    existing.server.close()
    activeMobileProxyBridges.delete(String(accountId))
  }

  const bridge = await listenProxyBridge(endpoint)
  const entry = {
    proxyId,
    adbSerial,
    hostPort: bridge.hostPort,
    server: bridge.server,
  }
  activeMobileProxyBridges.set(String(accountId), entry)
  emitLog(
    opts.emit,
    'MOBILE_PROXY_BRIDGE_STARTED',
    `proxy=${proxyId} upstream=${endpoint.host}:${endpoint.port} local=127.0.0.1:${bridge.hostPort}`,
  )
  return entry
}

/**
 * Start/update a no-auth local proxy bridge on the host and expose it inside the
 * Android device via `adb reverse`, so authenticated HTTP proxies can work for
 * Android apps that only understand host:port global proxies.
 *
 * @param {string} accountId
 * @param {Record<string, unknown>} accountRow
 * @param {string} adbSerial
 * @param {{ emit?: (action: string, details?: string) => void, adbPath?: string, timeoutMs?: number }} [opts]
 */
export async function ensureMobileProxyApplied(accountId, accountRow, adbSerial, opts = {}) {
  const proxyRow = getMobileProxyRow(accountRow)
  if (!proxyRow) {
    await clearMobileProxyApplied(accountId, adbSerial, opts)
    emitLog(opts.emit, 'MOBILE_PROXY_DISABLED', `account=${accountId}`)
    return { ok: true, applied: false }
  }

  const bridge = await ensureBridge(accountId, adbSerial, proxyRow, opts)
  await runAdb(adbSerial, ['reverse', `tcp:${MOBILE_PROXY_DEVICE_PORT}`, `tcp:${bridge.hostPort}`], opts)
  await setAndroidGlobalHttpProxy(adbSerial, MOBILE_PROXY_DEVICE_PORT, opts)
  emitLog(
    opts.emit,
    'MOBILE_PROXY_APPLIED',
    `account=${accountId} proxy=${proxyRow.id} serial=${adbSerial} device=127.0.0.1:${MOBILE_PROXY_DEVICE_PORT}`,
  )
  return { ok: true, applied: true, proxyId: proxyRow.id }
}

/**
 * Remove Android global proxy settings and close any local bridge for the account.
 *
 * @param {string} accountId
 * @param {string} adbSerial
 * @param {{ emit?: (action: string, details?: string) => void, adbPath?: string, timeoutMs?: number }} [opts]
 */
export async function clearMobileProxyApplied(accountId, adbSerial, opts = {}) {
  if (adbSerial) {
    await clearAndroidGlobalHttpProxy(adbSerial, opts)
  }
  const existing = activeMobileProxyBridges.get(String(accountId))
  if (existing) {
    existing.server.close()
    activeMobileProxyBridges.delete(String(accountId))
    emitLog(opts.emit, 'MOBILE_PROXY_BRIDGE_STOPPED', `account=${accountId}`)
  }
  return { ok: true }
}
