import { it, expect, vi } from 'vitest'
import { cleanupFixture } from './managedClaudeReconciliation.helpers'
import { deferred } from './managedClaudeLaunchCompatibility.helpers'

it.each(['deleted', 'superseded'] as const)(
  'cleans both runtimes when deferred reconciliation finds %s activation',
  async outcome => {
    const f = cleanupFixture()
    const activate = f.ports.activateManagedClaudeRuntime.getMockImplementation()!
    f.ports.activateManagedClaudeRuntime.mockImplementation(async input => {
      const result = await activate(input)
      f.setUnavailable(true)
      return result
    })
    try {
      const attempt = await f.admit()
      await expect(
        f.owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: f.tuple }),
      ).rejects.toMatchObject({ details: { outcome: 'unknown' } })
      expect(f.ports.killExactRuntime).not.toHaveBeenCalled()
      if (outcome === 'deleted') {
        f.remove()
      } else {
        f.supersede()
      }
      f.setUnavailable(false)
      f.timers[0]()
      await vi.waitFor(() =>
        expect(f.ports.killExactRuntime.mock.calls.map(([id]) => id).sort()).toEqual([
          'candidate',
          'fallback-shell',
        ]),
      )
      f.timers[0]()
      await f.owner.assertReady(f.owner.reserve('agent'))
      expect(f.ports.killExactRuntime).toHaveBeenCalledTimes(2)
      expect(f.ports.publishCommittedActivation).not.toHaveBeenCalled()
    } finally {
      f.owner.dispose()
    }
  },
)

it('settles both runtimes when confirmation immediately observes a later activation', async () => {
  const f = cleanupFixture()
  const activate = f.ports.activateManagedClaudeRuntime.getMockImplementation()!
  f.ports.activateManagedClaudeRuntime.mockImplementation(async input => {
    const result = await activate(input)
    f.supersede()
    return result
  })
  try {
    const attempt = await f.admit()
    await expect(
      f.owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: f.tuple }),
    ).rejects.toMatchObject({ details: { reason: 'superseded' } })
    expect(f.ports.killExactRuntime.mock.calls.map(([id]) => id).sort()).toEqual([
      'candidate',
      'fallback-shell',
    ])
  } finally {
    f.owner.dispose()
  }
})

it('checks the predecessor reference after definite noncommit and retains a still referenced shell', async () => {
  const f = cleanupFixture()
  f.ports.activateManagedClaudeRuntime.mockResolvedValue({
    status: 'retryableFailure',
    outcome: 'notCommitted',
  } as never)
  try {
    const attempt = await f.admit()
    await expect(
      f.owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: f.tuple }),
    ).rejects.toMatchObject({ details: { outcome: 'notCommitted' } })
    expect(f.ports.isRuntimeReferenced).toHaveBeenCalledWith('fallback-shell')
    expect(f.ports.killExactRuntime).toHaveBeenCalledExactlyOnceWith('candidate')
  } finally {
    f.owner.dispose()
  }
})

it('retains failed cleanup proof for the next request after successful finalization', async () => {
  const f = cleanupFixture()
  try {
    const attempt = await f.admit()
    f.setReferencesUnavailable(true)
    await f.owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: f.tuple })
    expect(f.ports.killExactRuntime).not.toHaveBeenCalled()
    f.setReferencesUnavailable(false)
    await f.owner.assertReady(f.owner.reserve('agent'))
    expect(f.ports.killExactRuntime).toHaveBeenCalledExactlyOnceWith('fallback-shell')
  } finally {
    f.owner.dispose()
  }
})

it('settles the captured predecessor when deletion fences activation before its transaction', async () => {
  const f = cleanupFixture()
  try {
    const attempt = await f.admit()
    f.remove()
    await expect(
      f.owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: f.tuple }),
    ).rejects.toMatchObject({ details: { reason: 'superseded' } })
    expect(f.ports.killExactRuntime.mock.calls.map(([id]) => id).sort()).toEqual([
      'candidate',
      'fallback-shell',
    ])
    expect(f.ports.activateManagedClaudeRuntime).not.toHaveBeenCalled()
  } finally {
    f.owner.dispose()
  }
})

it('retains a failed exact kill until a later request completes it', async () => {
  const f = cleanupFixture()
  f.ports.killExactRuntime.mockRejectedValueOnce(new Error('kill temporarily unavailable'))
  try {
    const attempt = await f.admit()
    await f.owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: f.tuple })
    expect(f.ports.killExactRuntime).toHaveBeenCalledExactlyOnceWith('fallback-shell')
    await f.owner.assertReady(f.owner.reserve('agent'))
    expect(f.ports.killExactRuntime.mock.calls).toEqual([['fallback-shell'], ['fallback-shell']])
    await f.owner.assertReady(f.owner.reserve('agent'))
    expect(f.ports.killExactRuntime).toHaveBeenCalledTimes(2)
  } finally {
    f.owner.dispose()
  }
})

it.each(['conflict', 'nodeGone'] as const)(
  'settles candidate and predecessor after transaction rejection: %s',
  async status => {
    const f = cleanupFixture()
    f.ports.activateManagedClaudeRuntime.mockImplementation(async () => {
      if (status === 'nodeGone') {
        f.remove()
      } else {
        f.supersede()
      }
      return { status } as never
    })
    try {
      const attempt = await f.admit()
      await expect(
        f.owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: f.tuple }),
      ).rejects.toMatchObject({ details: { reason: status } })
      expect(f.ports.killExactRuntime.mock.calls.map(([id]) => id).sort()).toEqual([
        'candidate',
        'fallback-shell',
      ])
    } finally {
      f.owner.dispose()
    }
  },
)

it('retains a displaced shell that another node still references after deferred deletion', async () => {
  const f = cleanupFixture()
  const activate = f.ports.activateManagedClaudeRuntime.getMockImplementation()!
  f.ports.activateManagedClaudeRuntime.mockImplementation(async input => {
    const result = await activate(input)
    if (input.runtimeSessionId !== null) {
      f.setUnavailable(true)
    }
    return result
  })
  try {
    const attempt = await f.admit()
    await expect(
      f.owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: f.tuple }),
    ).rejects.toBeDefined()
    f.remove()
    f.references.add('fallback-shell')
    f.setUnavailable(false)
    f.timers[0]()
    await vi.waitFor(() =>
      expect(f.ports.isRuntimeReferenced).toHaveBeenCalledWith('fallback-shell'),
    )
    expect(f.ports.killExactRuntime).toHaveBeenCalledExactlyOnceWith('candidate')
  } finally {
    f.owner.dispose()
  }
})

it('preserves a newer unknown obligation when an older activation response arrives late', async () => {
  const f = cleanupFixture()
  let sequence = 0
  f.ports.createId = () => `activation-${++sequence}`
  const firstResponse = deferred<{ status: 'committed'; revision: number }>()
  const committed = deferred<void>()
  const activate = f.ports.activateManagedClaudeRuntime.getMockImplementation()!
  f.ports.activateManagedClaudeRuntime.mockImplementation(async input => {
    const result = await activate(input)
    if (input.activationId === 'activation-1') {
      committed.resolve()
      return firstResponse.promise
    }
    if (input.runtimeSessionId !== null) {
      f.setUnavailable(true)
    }
    return result
  })
  let first!: Promise<unknown>
  try {
    const initial = await f.admit()
    first = f.owner.complete(initial, { runtimeSessionId: 'first', tuple: f.tuple })
    await committed.promise
    const next = f.owner.reserve('agent')
    next.context = f.context
    next.expected = { activationId: 'activation-1', tuple: f.tuple }
    await f.owner.admit(next, { provider: 'claude-code', cwd: '/repo', mountId: null })
    await expect(
      f.owner.complete(next, { runtimeSessionId: 'second', tuple: f.tuple }),
    ).rejects.toMatchObject({ details: { outcome: 'unknown' } })
    f.setUnavailable(false)
    firstResponse.resolve({ status: 'committed', revision: 2 })
    await expect(first).rejects.toMatchObject({ details: { reason: 'superseded' } })
    f.ports.isRuntimeReferenced.mockClear()
    expect(await f.owner.cleanup('second')).toBe(false)
    expect(f.ports.isRuntimeReferenced).not.toHaveBeenCalled()
    expect(f.owner.canAdmitRuntimeWrite('agent', 'second')).toBe(false)
    await f.owner.assertReady(next)
    expect(f.owner.canAdmitRuntimeWrite('agent', 'second')).toBe(true)
  } finally {
    f.setUnavailable(false)
    firstResponse.resolve({ status: 'committed', revision: 2 })
    await first?.catch(() => {})
    f.owner.dispose()
  }
})
