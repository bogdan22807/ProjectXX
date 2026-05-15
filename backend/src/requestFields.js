/**
 * Normalize request bodies so executors can use camelCase; API responses stay snake_case (DB columns).
 */

function has(o, k) {
  return o != null && Object.prototype.hasOwnProperty.call(o, k)
}

function normalizeNullableId(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}

function parseProxyEndpointInput(raw) {
  const value = trimStr(raw) ?? ''
  if (!value) return null
  if (!value.includes('@') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null
  try {
    const parsed = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? new URL(value) : new URL(`http://${value}`)
    const host = trimStr(parsed.hostname) ?? ''
    if (!host) return null
    return {
      host,
      port: trimStr(parsed.port) ?? '',
      username: parsed.username ? decodeURIComponent(parsed.username).trim() : '',
      password: parsed.password ? decodeURIComponent(parsed.password).trim() : '',
      scheme: trimStr(parsed.protocol.replace(':', '')) ?? '',
    }
  } catch {
    return null
  }
}

function missingProxyBodyValue(body, key) {
  if (!has(body, key)) return true
  const value = body?.[key]
  return value == null || String(value).trim() === ''
}

/** @param {Record<string, unknown> | null | undefined} body */
export function accountFieldsFromBody(body) {
  const b = body ?? {}
  /** @type {Record<string, unknown>} */
  const out = {}
  if (has(b, 'name')) out.name = b.name
  if (has(b, 'login')) out.login = b.login
  if (has(b, 'cookies')) out.cookies = b.cookies
  if (has(b, 'platform')) out.platform = b.platform
  if (has(b, 'account_type')) out.account_type = trimStr(b.account_type)
  else if (has(b, 'accountType')) out.account_type = trimStr(b.accountType)
  if (has(b, 'mobile_mode')) out.mobile_mode = trimStr(b.mobile_mode)
  else if (has(b, 'mode')) out.mobile_mode = trimStr(b.mode)
  if (has(b, 'mobile_proxy_id')) out.mobile_proxy_id = normalizeNullableId(b.mobile_proxy_id)
  else if (has(b, 'mobileProxyId')) out.mobile_proxy_id = normalizeNullableId(b.mobileProxyId)
  if (has(b, 'proxy_id')) out.proxy_id = normalizeNullableId(b.proxy_id)
  else if (has(b, 'proxyId')) out.proxy_id = normalizeNullableId(b.proxyId)
  if (has(b, 'browser_profile_id')) out.browser_profile_id = normalizeNullableId(b.browser_profile_id)
  else if (has(b, 'browserProfileId')) out.browser_profile_id = normalizeNullableId(b.browserProfileId)
  if (has(b, 'browser_engine')) out.browser_engine = b.browser_engine
  else if (has(b, 'browserEngine')) out.browser_engine = b.browserEngine
  if (has(b, 'mobile_device_id')) out.mobile_device_id = trimStr(b.mobile_device_id)
  else if (has(b, 'device_id')) out.mobile_device_id = trimStr(b.device_id)
  else if (has(b, 'deviceId')) out.mobile_device_id = trimStr(b.deviceId)
  if (has(b, 'mobile_emulator_name')) out.mobile_emulator_name = trimStr(b.mobile_emulator_name)
  else if (has(b, 'emulator_name')) out.mobile_emulator_name = trimStr(b.emulator_name)
  else if (has(b, 'emulatorName')) out.mobile_emulator_name = trimStr(b.emulatorName)
  if (has(b, 'mobile_vm_index')) out.mobile_vm_index = trimStr(b.mobile_vm_index)
  else if (has(b, 'emulator_index')) out.mobile_vm_index = trimStr(b.emulator_index)
  else if (has(b, 'emulatorIndex')) out.mobile_vm_index = trimStr(b.emulatorIndex)
  if (has(b, 'status')) out.status = b.status
  return out
}

/** Defaults for POST /accounts */
export function accountCreatePayload(body) {
  const raw = accountFieldsFromBody(body)
  const defaults = {
    name: 'Unnamed',
    login: '',
    cookies: '',
    platform: 'TikTok',
    account_type: 'browser',
    mobile_mode: 'mumu',
    mobile_proxy_id: null,
    proxy_id: null,
    browser_profile_id: null,
    browser_engine: 'chromium',
    mobile_device_id: '',
    mobile_emulator_name: '',
    mobile_vm_index: '',
    status: 'New',
  }
  const merged = { ...defaults, ...raw }
  merged.platform = 'TikTok'
  const nameTrim = merged.name == null ? '' : String(merged.name).trim()
  merged.name = nameTrim || 'Unnamed'
  merged.login = merged.login == null ? '' : String(merged.login)
  merged.cookies = merged.cookies == null ? '' : String(merged.cookies)
  merged.mobile_device_id = merged.mobile_device_id == null ? '' : String(merged.mobile_device_id)
  merged.mobile_emulator_name = merged.mobile_emulator_name == null ? '' : String(merged.mobile_emulator_name)
  merged.mobile_vm_index = merged.mobile_vm_index == null ? '' : String(merged.mobile_vm_index)
  return merged
}

/** @param {Record<string, unknown> | null | undefined} body */
export function accountPatchPayload(body) {
  const p = accountFieldsFromBody(body)
  if (Object.prototype.hasOwnProperty.call(p, 'platform')) {
    p.platform = 'TikTok'
  }
  /** DB columns are NOT NULL TEXT — never bind SQLite NULL for these. */
  const nnKeys = ['login', 'cookies', 'mobile_proxy_id', 'mobile_device_id', 'mobile_emulator_name', 'mobile_vm_index']
  for (const k of nnKeys) {
    if (!Object.prototype.hasOwnProperty.call(p, k)) continue
    const v = p[k]
    p[k] = v == null ? '' : String(v)
  }
  if (Object.prototype.hasOwnProperty.call(p, 'name')) {
    const t = p.name == null ? '' : String(p.name).trim()
    p.name = t || 'Unnamed'
  }
  return p
}

function trimStr(v) {
  if (v == null) return v
  return String(v).trim()
}

/** @param {Record<string, unknown> | null | undefined} body */
export function proxyFieldsFromBody(body) {
  const b = body ?? {}
  /** @type {Record<string, unknown>} */
  const out = {}
  if (has(b, 'provider')) out.provider = trimStr(b.provider)
  if (has(b, 'host')) out.host = trimStr(b.host)
  if (has(b, 'port')) out.port = trimStr(b.port)
  if (has(b, 'username')) out.username = trimStr(b.username)
  if (has(b, 'password')) out.password = trimStr(b.password)
  if (has(b, 'proxy_scheme')) out.proxy_scheme = trimStr(b.proxy_scheme)
  else if (has(b, 'proxyScheme')) out.proxy_scheme = trimStr(b.proxyScheme)
  if (has(b, 'status')) out.status = trimStr(b.status)
  if (has(b, 'assigned_to')) out.assigned_to = trimStr(b.assigned_to)
  else if (has(b, 'assignedTo')) out.assigned_to = trimStr(b.assignedTo)
  if (has(b, 'last_check')) out.last_check = b.last_check == null ? b.last_check : trimStr(b.last_check)
  else if (has(b, 'lastCheck')) out.last_check = b.lastCheck == null ? b.lastCheck : trimStr(b.lastCheck)

  const parsedEndpoint = parseProxyEndpointInput(
    has(b, 'host')
      ? b.host
      : has(b, 'proxy_host')
        ? b.proxy_host
        : undefined,
  )
  if (parsedEndpoint) {
    out.host = parsedEndpoint.host
    if (missingProxyBodyValue(b, 'port')) out.port = parsedEndpoint.port
    if (missingProxyBodyValue(b, 'username')) out.username = parsedEndpoint.username
    if (missingProxyBodyValue(b, 'password')) out.password = parsedEndpoint.password
    if (missingProxyBodyValue(b, 'proxy_scheme') && missingProxyBodyValue(b, 'proxyScheme') && parsedEndpoint.scheme) {
      out.proxy_scheme = parsedEndpoint.scheme
    }
  }
  return out
}

export function proxyCreatePayload(body) {
  const defaults = {
    provider: '',
    port: '',
    username: '',
    password: '',
    proxy_scheme: '',
    status: 'unknown',
    assigned_to: '',
    last_check: null,
  }
  const fromBody = proxyFieldsFromBody(body)
  const host = trimStr(fromBody.host ?? '')
  const port = trimStr(fromBody.port ?? '')
  const username = trimStr(fromBody.username ?? '')
  const password = trimStr(fromBody.password ?? '')
  const provider = trimStr(fromBody.provider ?? '') ?? ''
  const proxy_scheme = trimStr(fromBody.proxy_scheme ?? '') ?? ''
  const status = trimStr(fromBody.status ?? defaults.status) ?? defaults.status
  const assigned_to = trimStr(fromBody.assigned_to ?? '') ?? ''
  const last_check =
    fromBody.last_check == null || fromBody.last_check === ''
      ? null
      : trimStr(String(fromBody.last_check))

  return {
    ...defaults,
    provider,
    host,
    port,
    username,
    password,
    proxy_scheme,
    status,
    assigned_to,
    last_check,
  }
}

export function proxyPatchPayload(body) {
  return proxyFieldsFromBody(body)
}

/** @param {Record<string, unknown> | null | undefined} body */
export function profileFieldsFromBody(body) {
  const b = body ?? {}
  /** @type {Record<string, unknown>} */
  const out = {}
  if (has(b, 'name')) out.name = b.name
  if (has(b, 'linked_proxy_id')) out.linked_proxy_id = b.linked_proxy_id
  else if (has(b, 'linkedProxyId')) out.linked_proxy_id = b.linkedProxyId
  if (has(b, 'linked_account_id')) out.linked_account_id = b.linked_account_id
  else if (has(b, 'linkedAccountId')) out.linked_account_id = b.linkedAccountId
  if (has(b, 'status')) out.status = b.status
  return out
}

export function profileCreatePayload(body) {
  const defaults = {
    name: 'Unnamed profile',
    linked_proxy_id: null,
    linked_account_id: null,
    status: 'Ready',
  }
  return { ...defaults, ...profileFieldsFromBody(body) }
}

export function profilePatchPayload(body) {
  return profileFieldsFromBody(body)
}
