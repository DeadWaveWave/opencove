import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

export const RUNTIME_DIAGNOSTICS_MAX_BYTES = 512 * 1024
export const RUNTIME_DIAGNOSTICS_BACKUP_SUFFIX = '.1'

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
  }
}

function currentFileBytes(path: string): number {
  try {
    return statSync(path).size
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return 0
    }
    throw error
  }
}

export function appendBoundedRuntimeDiagnosticsLine(filePath: string, line: string): void {
  const rawLine = Buffer.from(`${line}\n`, 'utf8')
  const encodedLine =
    rawLine.length <= RUNTIME_DIAGNOSTICS_MAX_BYTES
      ? rawLine
      : Buffer.concat([rawLine.subarray(0, RUNTIME_DIAGNOSTICS_MAX_BYTES - 1), Buffer.from('\n')])
  const nextLineBytes = encodedLine.length
  mkdirSync(dirname(filePath), { recursive: true })

  const existingBytes = currentFileBytes(filePath)
  if (existingBytes > 0 && existingBytes + nextLineBytes > RUNTIME_DIAGNOSTICS_MAX_BYTES) {
    const backupPath = `${filePath}${RUNTIME_DIAGNOSTICS_BACKUP_SUFFIX}`
    removeIfPresent(backupPath)
    renameSync(filePath, backupPath)
  }

  appendFileSync(filePath, encodedLine, { mode: 0o600 })
}
