import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function readRuntimeAppVersion(): string | null {
  try {
    const packageJsonPath = resolve(__dirname, '../../../../package.json')
    const raw = readFileSync(packageJsonPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const version = (parsed as Record<string, unknown>).version
    return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null
  } catch {
    return null
  }
}
