import { normalizeProxyEndpoint } from '../proxyConfig.js'

/**
 * HTTP-only upstream for the mobile host proxy bridge + Android global `http_proxy`.
 *
 * @param {Record<string, unknown>} proxyRow
 * @returns {{ scheme: string, host: string, port: string, username: string, password: string }}
 */
export function validateMobileProxyRowForBridge(proxyRow) {
  const endpoint = normalizeProxyEndpoint(proxyRow)
  if (!endpoint?.host || !endpoint.port) {
    throw new Error('mobile proxy must include host and port')
  }
  if (endpoint.scheme !== 'http') {
    throw new Error(`mobile proxy currently supports only http proxies (got ${endpoint.scheme})`)
  }
  return endpoint
}
