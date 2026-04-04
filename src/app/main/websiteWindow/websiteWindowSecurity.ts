import { shell } from 'electron'

const EXTERNAL_PROTOCOL_ALLOWLIST = new Set(['http:', 'https:', 'mailto:'])

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl.trim())
  } catch {
    return null
  }
}

export function openExternalIfSafe(rawUrl: string): void {
  const parsed = parseUrl(rawUrl)
  if (!parsed || !EXTERNAL_PROTOCOL_ALLOWLIST.has(parsed.protocol)) {
    return
  }

  void shell.openExternal(parsed.toString()).catch(() => undefined)
}
