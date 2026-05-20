const allowedRemoteProtocols = new Set(['http:', 'https:'])
const allowedLocalProtocols = new Set(['data:', 'blob:'])
const blockedProtocols = new Set(['javascript:', 'vbscript:', 'file:'])

export function getUrlProtocol(value: string): string | 'relative' | 'invalid' {
  const trimmed = value.trim()

  if (!trimmed) {
    return 'invalid'
  }

  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return 'relative'
  }

  try {
    return new URL(trimmed).protocol
  }
  catch {
    return 'invalid'
  }
}

export function isSafeLinkUrl(value: string): boolean {
  const protocol = getUrlProtocol(value)

  if (protocol === 'relative') {
    return true
  }

  if (protocol === 'mailto:') {
    return true
  }

  if (protocol === 'invalid' || blockedProtocols.has(protocol)) {
    return false
  }

  return allowedRemoteProtocols.has(protocol)
}

export function isSafeImageUrl(value: string): boolean {
  const protocol = getUrlProtocol(value)

  if (protocol === 'relative') {
    return true
  }

  if (protocol === 'invalid' || blockedProtocols.has(protocol)) {
    return false
  }

  return allowedRemoteProtocols.has(protocol) || allowedLocalProtocols.has(protocol)
}
