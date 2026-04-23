/**
 * Normalize request bodies so executors can use camelCase; API responses stay snake_case (DB columns).
 */

function has(o, k) {
  return o != null && Object.prototype.hasOwnProperty.call(o, k)
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
  if (has(b, 'proxy_id')) out.proxy_id = b.proxy_id
  else if (has(b, 'proxyId')) out.proxy_id = b.proxyId
  if (has(b, 'browser_profile_id')) out.browser_profile_id = b.browser_profile_id
  else if (has(b, 'browserProfileId')) out.browser_profile_id = b.browserProfileId
  if (has(b, 'browser_engine')) out.browser_engine = b.browser_engine
  else if (has(b, 'browserEngine')) out.browser_engine = b.browserEngine
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
    proxy_id: null,
    browser_profile_id: null,
    browser_engine: 'chromium',
    status: 'New',
  }
  const merged = { ...defaults, ...raw }
  merged.platform = 'TikTok'
  return merged
}

/** @param {Record<string, unknown> | null | undefined} body */
export function accountPatchPayload(body) {
  const p = accountFieldsFromBody(body)
  if (Object.prototype.hasOwnProperty.call(p, 'platform')) {
    p.platform = 'TikTok'
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
  const b = body ?? {}
  const host = trimStr(has(b, 'host') ? b.host : fromBody.host)
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
