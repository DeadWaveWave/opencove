import { describe, expect, it, vi } from 'vitest'
import {
  createPtyScrollbackMirror,
  normalizePtySessionNodeBindingsPayload,
} from '../../../src/app/main/ipc/ptyScrollbackMirror'
import type { PersistWriteResult } from '../../../src/shared/contracts/dto/persistence'

async function flushMicrotasks(iterations = 10): Promise<void> {
  let chain = Promise.resolve()
  for (let index = 0; index < iterations; index += 1) {
    chain = chain.then(() => undefined)
  }
  await chain
}

async function waitForMockCalls(
  mockFn: { mock: { calls: unknown[] } },
  expectedCalls: number,
  remainingChecks = 50,
): Promise<void> {
  if (mockFn.mock.calls.length >= expectedCalls) {
    return
  }

  if (remainingChecks <= 0) {
    throw new Error(
      `Timed out waiting for ${expectedCalls} calls (got ${mockFn.mock.calls.length}).`,
    )
  }

  await Promise.resolve()
  await waitForMockCalls(mockFn, expectedCalls, remainingChecks - 1)
}

describe('ptyScrollbackMirror', () => {
  it('normalizes session/node bindings payloads', () => {
    expect(
      normalizePtySessionNodeBindingsPayload({
        bindings: [
          { sessionId: '  session-1 ', nodeId: ' node-1 ' },
          { sessionId: '', nodeId: 'node-2' },
          { sessionId: 'session-2', nodeId: '' },
          null,
          undefined,
          { sessionId: 'session-3', nodeId: 123 },
        ],
      }),
    ).toEqual({
      bindings: [{ sessionId: 'session-1', nodeId: 'node-1' }],
    })
  })

  it('persists detached session snapshots to node scrollback', async () => {
    const writeNodeScrollback = vi.fn(
      async (): Promise<PersistWriteResult> => ({ ok: true, level: 'full', bytes: 0 }),
    )
    const getPersistenceStore = vi.fn(async () => ({ writeNodeScrollback }))
    const snapshot = vi.fn(async () => 'hello')

    const mirror = createPtyScrollbackMirror({
      source: { snapshot },
      getPersistenceStore,
      flushIntervalMs: 999_999,
    })

    mirror.setBindings([{ sessionId: 'session-1', nodeId: 'node-1' }])

    await waitForMockCalls(writeNodeScrollback, 1)

    expect(writeNodeScrollback).toHaveBeenCalledTimes(1)
    expect(writeNodeScrollback).toHaveBeenCalledWith('node-1', 'hello')

    mirror.dispose()
  })

  it('dedupes unchanged snapshots between flushes', async () => {
    vi.useFakeTimers()

    const writeNodeScrollback = vi.fn(
      async (): Promise<PersistWriteResult> => ({ ok: true, level: 'full', bytes: 0 }),
    )
    const getPersistenceStore = vi.fn(async () => ({ writeNodeScrollback }))
    const snapshot = vi.fn(async () => 'hello')

    const mirror = createPtyScrollbackMirror({
      source: { snapshot },
      getPersistenceStore,
      flushIntervalMs: 10,
    })

    mirror.setBindings([{ sessionId: 'session-1', nodeId: 'node-1' }])

    await waitForMockCalls(writeNodeScrollback, 1)

    expect(writeNodeScrollback).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10)
    await flushMicrotasks()

    expect(writeNodeScrollback).toHaveBeenCalledTimes(1)

    mirror.dispose()
    vi.useRealTimers()
  })
})
