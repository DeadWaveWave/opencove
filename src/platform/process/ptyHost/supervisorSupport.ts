import { existsSync } from 'node:fs'
import { join } from 'node:path'

const RESTART_BACKOFF_BASE_DELAY_MS = 250
const RESTART_BACKOFF_MAX_DELAY_MS = 15_000

export function resolveBackoffDelay(attempt: number): number {
  if (attempt <= 0) {
    return RESTART_BACKOFF_BASE_DELAY_MS
  }
  const delay = RESTART_BACKOFF_BASE_DELAY_MS * 2 ** attempt
  return Math.min(delay, RESTART_BACKOFF_MAX_DELAY_MS)
}

export function nowMs(): number {
  return Date.now()
}

export function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve()
  }
  return new Promise(resolve => {
    setTimeout(resolve, delayMs)
  })
}

export function resolveBundledPtyHostEntryPath(baseDir: string): string {
  const candidates = [join(baseDir, 'ptyHost.js'), join(baseDir, '..', 'ptyHost.js')]
  const resolved = candidates.find(candidate => existsSync(candidate))
  if (!resolved) {
    throw new Error(`[pty-host] missing entry: ${candidates.join(', ')}`)
  }

  return resolved
}
