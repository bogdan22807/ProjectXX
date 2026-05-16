import { buildPlaywrightProxyConfig, resolvePlaywrightProxyScheme } from '../proxyConfig.js'
import { runAdb } from './adbRunner.js'

function emitLog(opts, action, details = '') {
  const d = String(details ?? '').trim()
  if (d) console.log(action, d)
  else console.log(action)
  opts?.emit?.(action, d)
}

function defaultPortForScheme(scheme) {
  if (scheme === 'https') return '443'
  if (scheme === 'socks5' || scheme === 'socks4') return '1080'
  return '80'
}

function parseEndpointFromProxyRow(proxyRow) {
  const launchProxy = buildPlaywrightProxyConfig(proxyRow)
  if (!launchProxy?.server) return null
  const parsed = new URL(launchProxy.server)
  const scheme = resolvePlaywrightProxyScheme(proxyRow)
  const host = parsed.hostname
  const port = parsed.port || defaultPortForScheme(scheme)
  const username = String(launchProxy.username ?? '').trim()
  const password = String(launchProxy.password ?? '').trim()
  if (!host || !port) return null
  return { host, port, username, password, scheme }
}

async function putGlobalSetting(adbSerial, key, value, opts = {}) {
  const normalized = String(value ?? '').trim()
  // `adb shell settings put ... ""` is treated as missing arg on many Android builds.
  // For empty values always remove setting instead of sending an empty argument.
  if (!normalized) {
    await deleteGlobalSetting(adbSerial, key, opts)
    return
  }
  await runAdb(adbSerial, ['shell', 'settings', 'put', 'global', key, normalized], opts)
}

async function deleteGlobalSetting(adbSerial, key, opts = {}) {
  await runAdb(adbSerial, ['shell', 'settings', 'delete', 'global', key], opts).catch(() => {})
}

export async function applyMobileProxyToDevice(opts = {}) {
  const adbSerial = String(opts.adbSerial ?? '').trim()
  if (!adbSerial) throw new Error('adbSerial is required for mobile proxy setup')
  const adbOpts = { adbPath: opts.adbPath, timeoutMs: opts.timeoutMs }
  const endpoint = parseEndpointFromProxyRow(opts.proxyRow)

  if (!endpoint) {
    await putGlobalSetting(adbSerial, 'http_proxy', ':0', adbOpts)
    await deleteGlobalSetting(adbSerial, 'global_http_proxy_host', adbOpts)
    await deleteGlobalSetting(adbSerial, 'global_http_proxy_port', adbOpts)
    await deleteGlobalSetting(adbSerial, 'global_http_proxy_username', adbOpts)
    await deleteGlobalSetting(adbSerial, 'global_http_proxy_password', adbOpts)
    await deleteGlobalSetting(adbSerial, 'global_http_proxy_exclusion_list', adbOpts)
    emitLog(opts, 'MOBILE_PROXY_CLEARED', `adb_serial=${adbSerial}`)
    return { applied: false, cleared: true }
  }

  await putGlobalSetting(adbSerial, 'http_proxy', `${endpoint.host}:${endpoint.port}`, adbOpts)
  await putGlobalSetting(adbSerial, 'global_http_proxy_host', endpoint.host, adbOpts)
  await putGlobalSetting(adbSerial, 'global_http_proxy_port', endpoint.port, adbOpts)
  await putGlobalSetting(
    adbSerial,
    'global_http_proxy_exclusion_list',
    process.env.MOBILE_PROXY_EXCLUSION_LIST ?? 'localhost,127.0.0.1,::1',
    adbOpts,
  )
  if (endpoint.username) {
    await putGlobalSetting(adbSerial, 'global_http_proxy_username', endpoint.username, adbOpts)
  } else {
    await deleteGlobalSetting(adbSerial, 'global_http_proxy_username', adbOpts)
  }
  if (endpoint.password) {
    await putGlobalSetting(adbSerial, 'global_http_proxy_password', endpoint.password, adbOpts)
  } else {
    await deleteGlobalSetting(adbSerial, 'global_http_proxy_password', adbOpts)
  }
  emitLog(
    opts,
    'MOBILE_PROXY_APPLIED',
    `adb_serial=${adbSerial} host=${endpoint.host} port=${endpoint.port} scheme=${endpoint.scheme} auth=${endpoint.username ? 'user+pass' : 'none'}`,
  )
  return {
    applied: true,
    cleared: false,
    host: endpoint.host,
    port: endpoint.port,
    scheme: endpoint.scheme,
    auth: Boolean(endpoint.username),
  }
}
