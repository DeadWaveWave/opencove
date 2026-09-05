import { TerminalRuntimeAvailability } from '@contexts/terminal/application/TerminalRuntimeAvailability'

describe('TerminalRuntimeAvailability', () => {
  it('keeps recovery failure separate from new-session admission', async () => {
    const availability = new TerminalRuntimeAvailability()
    availability.completeStartup(['workspace'])
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const pending = availability.reconcileWorkspace('workspace', async scope => {
      await gate
      expect(() => availability.assertSpawnAllowed('workspace', scope)).not.toThrow()
    })
    await expect(
      availability.reconcileWorkspace('workspace', async () => {
        throw new Error('failed node')
      }),
    ).rejects.toThrow('failed node')
    expect(availability.recoverySnapshot('workspace').phase).toBe('initializing')
    release()
    await pending
    expect(availability.recoverySnapshot('workspace')).toEqual({ phase: 'unavailable', epoch: 0 })
    expect(() => availability.assertSpawnAllowed('workspace', null)).not.toThrow()
    expect(() => availability.assertSpawnAllowed(null, null)).not.toThrow()
    await availability.reconcileWorkspace('workspace', async () => undefined)
    expect(availability.recoverySnapshot('workspace')).toEqual({ phase: 'ready', epoch: 1 })
  })

  it('keeps sibling recovery scopes valid until the whole concurrent cohort settles', async () => {
    const availability = new TerminalRuntimeAvailability()
    availability.completeStartup(['workspace'])
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const secondGate = new Promise<void>(resolve => {
      releaseSecond = resolve
    })
    let staleScope: unknown
    const first = availability.reconcileWorkspace('workspace', async scope => {
      staleScope = scope
      await firstGate
      expect(() => availability.assertSpawnAllowed('workspace', scope)).not.toThrow()
    })
    const second = availability.reconcileWorkspace('workspace', async scope => {
      await secondGate
      expect(() => availability.assertSpawnAllowed('workspace', scope)).not.toThrow()
    })
    try {
      releaseSecond()
      await second
      expect(availability.recoverySnapshot('workspace').phase).toBe('initializing')
      expect(() => availability.assertSpawnAllowed('workspace', null)).not.toThrow()
      expect(() => availability.assertSpawnAllowed(null, null)).not.toThrow()
      releaseFirst()
      await first
      expect(availability.recoverySnapshot('workspace')).toEqual({ phase: 'ready', epoch: 1 })
      availability.beginShutdown()
      expect(() => availability.assertSpawnAllowed('workspace', staleScope)).toThrow()
    } finally {
      releaseFirst()
      releaseSecond()
      await Promise.allSettled([first, second])
    }
  })

  it('opens new-session admission after startup without waiting for old nodes', async () => {
    const availability = new TerminalRuntimeAvailability()
    expect(() => availability.assertSpawnAllowed('workspace-recovery', null)).toThrowError(
      expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
    )
    expect(() => availability.assertSpawnAllowed(null, null)).toThrowError(
      expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
    )

    availability.completeStartup(['workspace-recovery'])
    expect(() => availability.assertSpawnAllowed('workspace-recovery', null)).not.toThrow()
    expect(() => availability.assertSpawnAllowed(null, null)).not.toThrow()
    expect(availability.recoverySnapshot('workspace-recovery')).toEqual({
      phase: 'initializing',
      epoch: 0,
    })

    await availability.reconcileWorkspace('workspace-recovery', scope => {
      expect(() => availability.assertSpawnAllowed('workspace-recovery', scope)).not.toThrow()
      return Promise.resolve()
    })

    expect(availability.recoverySnapshot('workspace-recovery')).toEqual({
      phase: 'ready',
      epoch: 1,
    })
    expect(() => availability.assertSpawnAllowed('workspace-recovery', null)).not.toThrow()
  })

  it('does not expose the recovery capability to a normal spawn in the same async operation', async () => {
    const availability = new TerminalRuntimeAvailability()
    availability.failStartup()

    await availability.reconcileWorkspace('workspace-recovery', scope => {
      expect(() => availability.assertSpawnAllowed('workspace-recovery', null)).toThrowError(
        expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
      )
      expect(() => availability.assertSpawnAllowed('other-workspace', scope)).toThrowError(
        expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
      )
      return Promise.resolve()
    })
  })

  it('allows new sessions in a workspace whose recovery has not started', async () => {
    const availability = new TerminalRuntimeAvailability()
    availability.completeStartup(['workspace-ready', 'workspace-initializing'])

    await availability.reconcileWorkspace('workspace-ready', () => Promise.resolve())

    expect(() => availability.assertSpawnAllowed('workspace-ready', null)).not.toThrow()
    expect(() => availability.assertSpawnAllowed('workspace-initializing', null)).not.toThrow()
    expect(() => availability.assertSpawnAllowed(null, null)).not.toThrow()
  })

  it('keeps failed recovery unavailable and ignores a late completion after shutdown', async () => {
    const availability = new TerminalRuntimeAvailability()
    availability.completeStartup(['workspace-failed', 'workspace-closing'])

    await expect(
      availability.reconcileWorkspace('workspace-failed', async () => {
        throw new Error('reconciliation failed')
      }),
    ).rejects.toThrow('reconciliation failed')
    expect(availability.recoverySnapshot('workspace-failed')).toEqual({
      phase: 'unavailable',
      epoch: 0,
    })

    let release!: () => void
    const gap = new Promise<void>(resolve => {
      release = resolve
    })
    const reconciliation = availability.reconcileWorkspace('workspace-closing', async scope => {
      await gap
      expect(() => availability.assertSpawnAllowed('workspace-closing', scope)).toThrowError(
        expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
      )
    })
    availability.beginShutdown()
    release()
    await reconciliation

    expect(() => availability.assertSpawnAllowed('workspace-closing', null)).toThrowError(
      expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
    )
    expect(() => availability.assertSpawnAllowed(null, null)).toThrowError(
      expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
    )
    expect(availability.recoverySnapshot('workspace-closing')).toEqual({
      phase: 'shutting-down',
      epoch: 0,
    })
  })

  it('retries a failed startup for one workspace without globally opening admission', async () => {
    const availability = new TerminalRuntimeAvailability()
    availability.failStartup()

    expect(() => availability.assertSpawnAllowed('workspace-retry', null)).toThrowError(
      expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
    )

    await availability.reconcileWorkspace('workspace-retry', scope => {
      expect(() => availability.assertSpawnAllowed('workspace-retry', scope)).not.toThrow()
      expect(() => availability.assertSpawnAllowed('other-workspace', null)).toThrowError(
        expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
      )
      return Promise.resolve()
    })

    expect(availability.recoverySnapshot('workspace-retry')).toEqual({ phase: 'ready', epoch: 1 })
    expect(() => availability.assertSpawnAllowed('workspace-retry', null)).not.toThrow()
    expect(() => availability.assertSpawnAllowed('other-workspace', null)).toThrowError(
      expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
    )
    expect(() => availability.assertSpawnAllowed(null, null)).toThrowError(
      expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
    )
  })
})
