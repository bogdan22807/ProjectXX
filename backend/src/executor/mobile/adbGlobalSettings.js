import { runAdb } from './adbRunner.js'

const DEFAULT_MOBILE_PROXY_EXCLUSION_LIST = 'localhost,127.0.0.1,::1'

export function readMobileProxyExclusionList(env = process.env) {
  const raw = String(env?.MOBILE_PROXY_EXCLUSION_LIST ?? '').trim()
  return raw || DEFAULT_MOBILE_PROXY_EXCLUSION_LIST
}

export async function deleteGlobalSetting(adbSerial, key, opts = {}) {
  await runAdb(adbSerial, ['shell', 'settings', 'delete', 'global', key], opts)
}

export async function putOrDeleteGlobalSetting(adbSerial, key, value, opts = {}) {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    await deleteGlobalSetting(adbSerial, key, opts)
    return
  }
  await runAdb(adbSerial, ['shell', 'settings', 'put', 'global', key, normalized], opts)
}
