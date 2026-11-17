import { describe, expect, it, vi } from 'vitest'
import type { PersistWriteResult } from '../../../src/shared/contracts/dto'
import { createPersistenceDiagnostics } from '../../../src/app/renderer/shell/hooks/persistenceDiagnostics'

const failure: PersistWriteResult = {
  ok: false,
  reason: 'io',
  outcome: 'notSubmitted',
  error: {
    code: 'persistence.io_failed',
    debugMessage: 'SqliteError(SQLITE_BUSY): database is locked',
    details: { stage: 'worker-store', nodeTitle: 'PRIVATE', state: 'PRIVATE' },
  },
}

describe('persistence diagnostics', () => {
  it('records exactly one flat diagnostic with only error fields', () => {
    const log = vi.fn()
    const record = createPersistenceDiagnostics(log)
    record(failure, 'persistence.ioFailed', 1000)
    expect(log).toHaveBeenCalledExactlyOnceWith({
      source: 'renderer-persistence',
      level: 'error',
      event: 'persistence-write-failed',
      message: 'Workspace save failed.',
      details: {
        errorCode: 'persistence.io_failed',
        reason: 'io',
        outcome: 'notSubmitted',
        debugMessage: 'SqliteError(SQLITE_BUSY): database is locked',
        stage: 'worker-store',
        noticeKey: 'persistence.ioFailed',
        suppressedCount: 0,
      },
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE')
  })

  it('uses null for missing fields and renderer for untagged failures', () => {
    const log = vi.fn()
    createPersistenceDiagnostics(log)(
      { ok: false, reason: 'unknown', error: { code: 'persistence.invalid_state' } },
      'persistence.failed',
      1000,
    )
    expect(log.mock.calls[0][0].details).toMatchObject({
      outcome: null,
      debugMessage: null,
      stage: 'renderer',
    })
  })

  it('limits each signature independently to once per minute and reports suppressed repeats', () => {
    const log = vi.fn()
    const record = createPersistenceDiagnostics(log)
    record(failure, 'persistence.ioFailed', 1000)
    record(failure, 'persistence.ioFailed', 1001)
    record(failure, 'persistence.ioFailed', 60_999)
    record({ ...failure, outcome: 'unknown' }, 'persistence.saveUnconfirmed', 60_999)
    expect(log).toHaveBeenCalledTimes(2)
    record(failure, 'persistence.ioFailed', 61_000)
    expect(log).toHaveBeenCalledTimes(3)
    expect(log.mock.calls[2][0].details.suppressedCount).toBe(2)
    record(failure, 'persistence.ioFailed', 121_000)
    expect(log.mock.calls[3][0].details.suppressedCount).toBe(0)
  })

  it('reports recovery once, including suppressed failures, then starts a fresh episode', () => {
    const log = vi.fn()
    const record = createPersistenceDiagnostics(log)
    const success: PersistWriteResult = { ok: true, level: 'full', bytes: 1 }
    record(success, null, 0)
    record(failure, 'persistence.ioFailed', 1000)
    record(failure, 'persistence.ioFailed', 1001)
    record(success, null, 1002)
    record(success, null, 1003)
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[1][0]).toEqual({
      source: 'renderer-persistence',
      level: 'info',
      event: 'persistence-write-recovered',
      message: 'Workspace save recovered.',
      details: { failedCount: 2, firstFailedAt: new Date(1000).toISOString() },
    })
    record(failure, 'persistence.ioFailed', 1004)
    expect(log).toHaveBeenCalledTimes(3)
  })

  it('swallows both synchronous logging errors and rejected logging promises', async () => {
    for (const log of [
      () => {
        throw Error('offline')
      },
      () => Promise.reject(Error('offline')),
    ]) {
      const record = createPersistenceDiagnostics(log)
      expect(() => record(failure, 'persistence.ioFailed', 1000)).not.toThrow()
      expect(() => record({ ok: true, level: 'full', bytes: 1 }, null, 1001)).not.toThrow()
      await Promise.resolve()
    }
  })
})
