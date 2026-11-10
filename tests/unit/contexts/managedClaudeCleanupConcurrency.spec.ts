import { it, expect, vi } from 'vitest'
import { cleanupFixture } from './managedClaudeReconciliation.helpers'
import { deferred } from './managedClaudeLaunchCompatibility.helpers'
import { ManagedClaudeRuntimeCleanup } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeRuntimeCleanup'

it('retries a failed deletion kill queued between confirmation and deferred finalization', async () => {
  const f = cleanupFixture()
  const read = f.ports.observeNode.getMockImplementation()!
  let deletionQueued = false
  let deleting: Promise<boolean> | undefined
  let candidateKills = 0
  f.ports.observeNode.mockImplementation(() => {
    const observation = read()
    if (observation.binding?.activationId === 'replacement' && !deletionQueued) {
      deletionQueued = true
      queueMicrotask(() => {
        f.remove()
        deleting = f.owner.cleanup('candidate')
      })
    }
    return observation
  })
  f.ports.killExactRuntime.mockImplementation(async id => {
    if (id === 'candidate' && ++candidateKills === 1) {
      throw new Error('kill unavailable')
    }
  })
  try {
    const attempt = await f.admit()
    await f.owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: f.tuple })
    await deleting
    expect(deletionQueued).toBe(true)
    expect(candidateKills).toBe(1)
    expect(f.owner.canAdmitRuntimeWrite('agent', 'candidate')).toBe(false)
    await f.owner.assertReady(f.owner.reserve('agent'))
    expect(candidateKills).toBe(2)
    await f.owner.assertReady(f.owner.reserve('agent'))
    expect(candidateKills).toBe(2)
  } finally {
    f.owner.dispose()
  }
})

it('retains a newer cleanup request while an earlier exact kill is awaiting completion', async () => {
  const kill = deferred<void>()
  const entered = deferred<void>()
  let referenced = false,
    reads = 0,
    kills = 0
  const cleanup = new ManagedClaudeRuntimeCleanup(
    {
      isRuntimeReferenced: () => {
        reads++
        return referenced
      },
      killExactRuntime: async () => {
        kills++
        entered.resolve()
        await kill.promise
      },
    },
    () => false,
  )
  const first = cleanup.cleanup('runtime')
  await entered.promise
  const newer = cleanup.cleanup('runtime')
  referenced = true
  kill.resolve()
  await Promise.all([first, newer])
  const before = reads
  await cleanup.flush()
  expect(reads).toBeGreaterThan(before)
  expect(kills).toBe(1)
})

it('rechecks later claims without killing a successfully terminated exact ID again', async () => {
  const read = vi.fn(() => false)
  const kill = vi.fn(async () => {})
  const cleanup = new ManagedClaudeRuntimeCleanup(
    { isRuntimeReferenced: read, killExactRuntime: kill },
    () => false,
  )
  expect(await cleanup.cleanup('runtime')).toBe(true)
  read.mockImplementationOnce(() => {
    throw new Error('reference read unavailable')
  })
  expect(await cleanup.cleanup('runtime')).toBe(false)
  expect(cleanup.pendingRuntimeIds()).toEqual(['runtime'])
  await cleanup.flush()
  expect(read).toHaveBeenCalledTimes(3)
  expect(kill).toHaveBeenCalledExactlyOnceWith('runtime')
  expect(cleanup.pendingRuntimeIds()).toEqual([])
})

it('keeps the current reconciliation timer when a canceled older callback arrives late', async () => {
  const f = cleanupFixture()
  const callbacks: (() => void)[] = [],
    cancels: ReturnType<typeof vi.fn>[] = []
  f.ports.scheduleReconciliation = callback => {
    callbacks.push(callback)
    const cancel = vi.fn()
    cancels.push(cancel)
    return cancel
  }
  let sequence = 0
  f.ports.createId = () => `activation-${++sequence}`
  const activate = f.ports.activateManagedClaudeRuntime.getMockImplementation()!
  f.ports.activateManagedClaudeRuntime.mockImplementation(async input => {
    const result = await activate(input)
    if (input.runtimeSessionId !== null) {
      f.setUnavailable(true)
    }
    return result
  })
  try {
    const first = await f.admit()
    await expect(
      f.owner.complete(first, { runtimeSessionId: 'first', tuple: f.tuple }),
    ).rejects.toBeDefined()
    f.setUnavailable(false)
    const next = f.owner.reserve('agent')
    next.context = f.context
    next.expected = { activationId: 'activation-1', tuple: f.tuple }
    await f.owner.admit(next, { provider: 'claude-code', cwd: '/repo', mountId: null })
    expect(cancels[0]).toHaveBeenCalledTimes(1)
    await expect(
      f.owner.complete(next, { runtimeSessionId: 'second', tuple: f.tuple }),
    ).rejects.toBeDefined()
    callbacks[0]()
    f.owner.dispose()
    expect(cancels[1]).toHaveBeenCalledTimes(1)
  } finally {
    f.owner.dispose()
  }
})

it('rechecks current readiness when a newer obligation appears during finalization cleanup', async () => {
  const f = cleanupFixture()
  let sequence = 0
  f.ports.createId = () => `activation-${++sequence}`
  const firstResponse = deferred<{ status: 'committed'; revision: number }>()
  const committed = deferred<void>(),
    cleanupEntered = deferred<void>(),
    finishCleanup = deferred<void>()
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
  f.ports.killExactRuntime.mockImplementation(async id => {
    if (id === 'fallback-shell') {
      cleanupEntered.resolve()
      await finishCleanup.promise
    }
  })
  let first: Promise<unknown> | undefined
  try {
    const attempt = await f.admit()
    first = f.owner.complete(attempt, { runtimeSessionId: 'first', tuple: f.tuple })
    await committed.promise
    const readiness = f.owner.assertReady(attempt).then(
      () => ({ error: null }),
      error => ({ error }),
    )
    await cleanupEntered.promise
    attempt.expected = { activationId: 'activation-1', tuple: f.tuple }
    await expect(
      f.owner.complete(attempt, { runtimeSessionId: 'second', tuple: f.tuple }),
    ).rejects.toMatchObject({ details: { outcome: 'unknown' } })
    finishCleanup.resolve()
    expect(await readiness).toMatchObject({ error: { details: { outcome: 'unknown' } } })
    expect(f.owner.canAdmitRuntimeWrite('agent', 'second')).toBe(false)
  } finally {
    f.setUnavailable(false)
    finishCleanup.resolve()
    firstResponse.resolve({ status: 'committed', revision: 2 })
    await first?.catch(() => {})
    f.owner.dispose()
  }
})

it('schedules a product retry for a newer claim after the shared exact kill succeeds', async () => {
  vi.useFakeTimers()
  const entered = deferred<void>(),
    finish = deferred<void>()
  const read = vi.fn(() => false),
    kill = vi.fn(async () => {
      entered.resolve()
      await finish.promise
    })
  const cleanup = new ManagedClaudeRuntimeCleanup(
    {
      isRuntimeReferenced: read,
      killExactRuntime: kill,
      scheduleReconciliation: (callback, delay) => {
        const timer = setTimeout(callback, delay)
        return () => clearTimeout(timer)
      },
    },
    () => false,
  )
  try {
    const first = cleanup.cleanup('runtime')
    await entered.promise
    const later = cleanup.cleanup('runtime')
    finish.resolve()
    await Promise.all([first, later])
    expect(cleanup.pendingRuntimeIds()).toEqual(['runtime'])
    expect(vi.getTimerCount()).toBe(1)
    await vi.runOnlyPendingTimersAsync()
    expect(read).toHaveBeenCalledTimes(2)
    expect(kill).toHaveBeenCalledTimes(1)
    expect(cleanup.pendingRuntimeIds()).toEqual([])
  } finally {
    finish.resolve()
    cleanup.dispose()
    vi.useRealTimers()
  }
})

it.each(['reference', 'kill'] as const)(
  'cancels a %s-failure cleanup retry and ignores its late callback after disposal',
  async failure => {
    let callback!: () => void
    const cancel = vi.fn()
    const read = vi.fn(() => {
      if (failure === 'reference') {
        throw new Error('read unavailable')
      }
      return false
    })
    const kill = vi.fn(async () => {
      throw new Error('kill unavailable')
    })
    const cleanup = new ManagedClaudeRuntimeCleanup(
      {
        isRuntimeReferenced: read,
        killExactRuntime: kill,
        scheduleReconciliation: retry => {
          callback = retry
          return cancel
        },
      },
      () => false,
    )
    expect(await cleanup.cleanup('runtime')).toBe(false)
    expect(cleanup.pendingRuntimeIds()).toEqual(['runtime'])
    cleanup.dispose()
    expect(cancel).toHaveBeenCalledTimes(1)
    callback()
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(1)
    expect(kill).toHaveBeenCalledTimes(failure === 'kill' ? 1 : 0)
  },
)
