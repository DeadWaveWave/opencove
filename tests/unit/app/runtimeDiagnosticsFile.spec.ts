import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  appendBoundedRuntimeDiagnosticsLine,
  RUNTIME_DIAGNOSTICS_BACKUP_SUFFIX,
  RUNTIME_DIAGNOSTICS_MAX_BYTES,
} from '../../../src/platform/persistence/runtimeDiagnosticsFile'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('runtime diagnostics file', () => {
  it('rotates before the active log exceeds its byte budget', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'opencove-runtime-diagnostics-'))
    temporaryDirectories.push(directory)
    const filePath = resolve(directory, 'logs', 'runtime-diagnostics.log')
    const line = JSON.stringify({ event: 'renderer-performance', message: 'x'.repeat(8_000) })

    for (let index = 0; index < 90; index += 1) {
      appendBoundedRuntimeDiagnosticsLine(filePath, line)
    }

    expect(statSync(filePath).size).toBeLessThanOrEqual(RUNTIME_DIAGNOSTICS_MAX_BYTES)
    expect(statSync(`${filePath}${RUNTIME_DIAGNOSTICS_BACKUP_SUFFIX}`).size).toBeLessThanOrEqual(
      RUNTIME_DIAGNOSTICS_MAX_BYTES,
    )
    expect(readFileSync(filePath, 'utf8')).toContain('renderer-performance')
  })
})
