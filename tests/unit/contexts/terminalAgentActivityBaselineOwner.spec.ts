import { describe, expect, it, vi } from 'vitest'
import { createTerminalAgentActivityBaselineOwner } from '../../../src/contexts/terminal/presentation/renderer/terminalAgentActivityBaselineOwner'
import type { TerminalSessionMetadataEvent } from '../../../src/shared/contracts/dto'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function metadata({
  sessionId = 'session-1',
  generation = 1,
  revision = 1,
  phase = 'active',
  observedAtMs = 1_000 + revision,
}: {
  sessionId?: string
  generation?: number
  revision?: number
  phase?: 'active' | 'exited'
  observedAtMs?: number
} = {}): TerminalSessionMetadataEvent & {
  terminalAgentActivity: NonNullable<TerminalSessionMetadataEvent['terminalAgentActivity']>
} {
  return {
    sessionId,
    resumeSessionId: null,
    terminalAgentActivity: {
      provider: 'claude-code',
      invocationId: `invocation-${generation}`,
      generation,
      phase,
      observedAtMs,
      identityAuthority: null,
      sourceRevision: revision,
      revision,
    },
  }
}

function createSource() {
  let listener: ((event: TerminalSessionMetadataEvent) => void) | null = null
  const unsubscribe = vi.fn()
  return {
    source: {
      onMetadata: (next: (event: TerminalSessionMetadataEvent) => void) => {
        listener = next
        return unsubscribe
      },
    },
    emit: (event: TerminalSessionMetadataEvent) => listener?.(event),
    unsubscribe,
  }
}

describe('Terminal Agent activity baseline owner', () => {
  it('subscribes first and filters a late baseline behind a live generation/revision', async () => {
    const order: string[] = []
    const query = deferred<readonly ReturnType<typeof metadata>[]>()
    let liveListener: ((event: TerminalSessionMetadataEvent) => void) | null = null
    const applied: TerminalSessionMetadataEvent[] = []
    const owner = createTerminalAgentActivityBaselineOwner({
      source: {
        onMetadata: listener => {
          order.push('subscribe')
          liveListener = listener
          return () => undefined
        },
      },
      api: {
        listLatestMetadata: () => {
          order.push('query')
          return query.promise
        },
      },
      applyMetadata: event => applied.push(event),
    })

    expect(order).toEqual(['subscribe', 'query'])
    const live = metadata({ generation: 2, revision: 4 })
    liveListener?.(live)
    liveListener?.(metadata({ generation: 2, revision: 3 }))
    query.resolve([
      metadata({ generation: 1, revision: 99 }),
      metadata({ generation: 2, revision: 3 }),
      metadata({ sessionId: 'session-2', revision: 1 }),
    ])
    await query.promise
    await Promise.resolve()

    expect(applied).toEqual([live, metadata({ sessionId: 'session-2', revision: 1 })])
    expect(owner.getLatestMetadata('session-1')).toEqual(live)
    expect(owner.getLatestMetadata('session-2')).toEqual(
      metadata({ sessionId: 'session-2', revision: 1 }),
    )
  })

  it('ignores async completion after disposal and isolates a later remount', async () => {
    const firstQuery = deferred<readonly ReturnType<typeof metadata>[]>()
    const firstSource = createSource()
    const firstApply = vi.fn()
    const first = createTerminalAgentActivityBaselineOwner({
      source: firstSource.source,
      api: { listLatestMetadata: () => firstQuery.promise },
      applyMetadata: firstApply,
    })
    first.dispose()

    const secondSource = createSource()
    const secondApply = vi.fn()
    const second = createTerminalAgentActivityBaselineOwner({
      source: secondSource.source,
      api: { listLatestMetadata: async () => [metadata({ revision: 2 })] },
      applyMetadata: secondApply,
    })
    await vi.waitFor(() => expect(secondApply).toHaveBeenCalledTimes(1))

    firstQuery.resolve([metadata({ revision: 1 })])
    await firstQuery.promise
    await Promise.resolve()
    expect(firstApply).not.toHaveBeenCalled()
    expect(firstSource.unsubscribe).toHaveBeenCalledTimes(1)
    expect(secondApply).toHaveBeenCalledWith(metadata({ revision: 2 }))
    second.dispose()
  })

  it('keeps live streaming usable when the baseline query fails', async () => {
    const source = createSource()
    const query = deferred<readonly ReturnType<typeof metadata>[]>()
    const applyMetadata = vi.fn()
    const owner = createTerminalAgentActivityBaselineOwner({
      source: source.source,
      api: { listLatestMetadata: () => query.promise },
      applyMetadata,
    })

    query.reject(new Error('query unavailable'))
    await query.promise.catch(() => undefined)
    await Promise.resolve()
    const live = metadata({ revision: 8 })
    source.emit(live)

    expect(applyMetadata).toHaveBeenCalledWith(live)
    expect(source.unsubscribe).not.toHaveBeenCalled()
    owner.dispose()
  })

  it('lets a newer baseline advance beyond an earlier live event', async () => {
    const source = createSource()
    const query = deferred<readonly ReturnType<typeof metadata>[]>()
    const applyMetadata = vi.fn()
    const owner = createTerminalAgentActivityBaselineOwner({
      source: source.source,
      api: { listLatestMetadata: () => query.promise },
      applyMetadata,
    })
    const live = metadata({ revision: 2 })
    const baseline = metadata({ revision: 3, phase: 'exited' })
    source.emit(live)
    query.resolve([baseline])
    await query.promise
    await Promise.resolve()

    expect(applyMetadata.mock.calls.map(([event]) => event)).toEqual([live, baseline])
    expect(owner.getLatestMetadata('session-1')).toEqual(baseline)
    owner.dispose()
  })
})
