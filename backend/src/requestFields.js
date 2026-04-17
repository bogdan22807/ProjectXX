/**
 * Normalize request bodies so executors can use camelCase; API responses stay snake_case (DB columns).
 */

import { parseProxyFourPartLine } from './proxyLineParse.js'

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
  if (has(b, 'status')) out.status = b.status
  return out
}

/** Defaults for POST /accounts */
export function accountCreatePayload(body) {
  const defaults = {
    name: 'Unnamed',
    login: '',
    cookies: '',
    platform: 'Other',
    proxy_id: null,
    browser_profile_id: null,
    status: 'New',
  }
  return { ...defaults, ...accountFieldsFromBody(body) }
}

/** @param {Record<string, unknown> | null | undefined} body */
export function accountPatchPayload(body) {
  return accountFieldsFromBody(body)
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
  if (has(b, 'proxy_line')) out.proxy_line = trimStr(b.proxy_line)
  else if (has(b, 'proxyLine')) out.proxy_line = trimStr(b.proxyLine)
  if (has(b, 'credential_order')) out.credential_order = trimStr(b.credential_order)
  else if (has(b, 'credentialOrder')) out.credential_order = trimStr(b.credentialOrder)
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
    status: 'Needs Check',
    assigned_to: '',
    last_check: null,
  }
  const fromBody = proxyFieldsFromBody(body)
  const b = body ?? {}
  let host = trimStr(has(b, 'host') ? b.host : fromBody.host)
  let port = trimStr(fromBody.port ?? '')
  let username = trimStr(fromBody.username ?? '')
  let password = trimStr(fromBody.password ?? '')

  const line = trimStr(fromBody.proxy_line ?? '')
  const orderRaw = trimStr(fromBody.credential_order ?? '').toLowerCase()
  const order = orderRaw === 'user_pass' ? 'user_pass' : 'pass_user'

  if (line) {
    const p = parseProxyFourPartLine(line, order)
    if (p) {
      host = p.host
      port = p.port
      username = p.username
      password = p.password
    }
  } else if (host && host.split(':').length === 4) {
    const p = parseProxyFourPartLine(host, order)
    if (p) {
      host = p.host
      port = p.port
      username = p.username
      password = p.password
    }
  }

  const proxy_scheme = trimStr(fromBody.proxy_scheme ?? '') ?? ''
  return { ...defaults, ...fromBody, host, port, username, password, proxy_scheme }
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
