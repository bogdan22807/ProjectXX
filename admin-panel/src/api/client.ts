const configuredBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
const base = configuredBase
  ? configuredBase.endsWith('/api')
    ? configuredBase
    : `${configuredBase}/api`
  : '/api'

type ApiSuccess<T> = {
  success: true
  data?: T
}

type ApiFailure = {
  success: false
  error?: string
}

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure

export class ApiError extends Error {
  readonly status: number
  readonly path: string

  constructor(message: string, path: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.path = path
    this.status = status
  }
}

async function readErrorMessage(res: Response, path: string): Promise<string> {
  const text = await res.text()
  if (!text) return `${path} ${res.status}`
  try {
    const j = JSON.parse(text) as ApiEnvelope<unknown> | { error?: string }
    if (
      j &&
      typeof j === 'object' &&
      'success' in j &&
      j.success === false &&
      typeof j.error === 'string' &&
      j.error.trim()
    ) {
      return `${path} ${res.status}: ${j.error.trim()}`
    }
    if (j && typeof j === 'object' && 'error' in j && typeof j.error === 'string' && j.error.trim()) {
      return `${path} ${res.status}: ${j.error.trim()}`
    }
  } catch {
    /* use raw */
  }
  const trimmed = text.trim()
  if (trimmed.length > 120) return `${path} ${res.status}`
  return `${path} ${res.status}: ${trimmed}`
}

async function parseJsonOk<T>(res: Response, path: string): Promise<T> {
  const text = await res.text()
  if (!text.trim()) {
    throw new ApiError(`Invalid JSON response (${res.status})`, path, res.status)
  }

  let parsed: ApiEnvelope<T>
  try {
    parsed = JSON.parse(text) as ApiEnvelope<T>
  } catch {
    throw new ApiError(`Invalid JSON response (${res.status})`, path, res.status)
  }

  if (!parsed || typeof parsed !== 'object' || !('success' in parsed)) {
    throw new ApiError(`Invalid JSON response (${res.status})`, path, res.status)
  }

  if (!parsed.success) {
    throw new ApiError(
      parsed.error?.trim() ? `${path} ${res.status}: ${parsed.error.trim()}` : `${path} ${res.status}`,
      path,
      res.status,
    )
  }

  return parsed.data as T
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`)
  if (!res.ok) {
    throw new ApiError(await readErrorMessage(res, path), path, res.status)
  }
  return parseJsonOk<T>(res, path)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new ApiError(await readErrorMessage(res, path), path, res.status)
  }
  return parseJsonOk<T>(res, path)
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new ApiError(await readErrorMessage(res, path), path, res.status)
  }
  return parseJsonOk<T>(res, path)
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${base}${path}`, { method: 'DELETE' })
  if (!res.ok) {
    throw new ApiError(await readErrorMessage(res, path), path, res.status)
  }
  await parseJsonOk<undefined>(res, path)
}
