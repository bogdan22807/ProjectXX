import type { Proxy, ProxyStatus } from '../types/domain'

const LABELS: Record<ProxyStatus, string> = {
  unknown: 'Не проверен',
  checking: 'Проверяется...',
  ok: 'Работает',
  auth_failed: 'Неверный логин или пароль',
  timeout: 'Прокси не отвечает',
  network: 'Прокси не отвечает',
  bad_request: 'Неверный формат прокси',
}

const COLORS: Record<ProxyStatus, string> = {
  unknown: '#6b7280',
  checking: '#f59e0b',
  ok: '#22c55e',
  auth_failed: '#ef4444',
  timeout: '#ef4444',
  network: '#ef4444',
  bad_request: '#ef4444',
}

function parseOutboundIp(checkResult: string): string | null {
  const s = String(checkResult ?? '').trim()
  if (!s) return null
  try {
    const j = JSON.parse(s) as { outboundIp?: string }
    if (j && typeof j.outboundIp === 'string' && j.outboundIp.trim()) return j.outboundIp.trim()
  } catch {
    return null
  }
  return null
}

export function ProxyStatusLine({
  proxy,
  showOutboundIp = true,
}: {
  proxy: Proxy
  /** When false, show only the status label (e.g. «Работает»); IP stays in title tooltip. */
  showOutboundIp?: boolean
}) {
  const st = proxy.status
  const label = LABELS[st] ?? LABELS.unknown
  const color = COLORS[st] ?? COLORS.unknown
  const ip = st === 'ok' ? parseOutboundIp(proxy.checkResult) : null
  const text = showOutboundIp && ip ? `${label} · ${ip}` : label
  const title =
    proxy.checkResult?.trim() ||
    (ip ? `outbound IP: ${ip}` : undefined) ||
    undefined

  return (
    <span className="text-sm font-medium" style={{ color }} title={title}>
      {text}
    </span>
  )
}
