import process from 'node:process'

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

export function normalizeComparablePath(pathValue: string): string {
  const normalized = pathValue.trim()
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}
