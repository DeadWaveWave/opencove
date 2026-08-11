import { TerminalRuntimeAvailability } from '@contexts/terminal/application/TerminalRuntimeAvailability'

describe('TerminalRuntimeAvailability', () => {
  it('blocks startup candidates until reconciliation opens a new ready epoch', async () => {
    const availability = new TerminalRuntimeAvailability()
    availability.completeStartup(['workspace-recovery'])

    expect(() => availability.assertSpawnAllowed('workspace-recovery', null)).toThrowError(
      expect.objectContaining({ code: 'terminal.runtime_not_ready' }),
    )
    expect(availability.snapshot('workspace-recovery')).toEqual({
      phase: 'initializing',
      epoch: 0,
    })

    await availability.reconcileWorkspace('workspace-recovery', scope => {
      expect(() => availability.assertSpawnAllowed('workspace-recovery', scope)).not.toThrow()
      return Promise.resolve()
    })

    expect(availability.snapshot('workspace-recovery')).toEqual({ phase: 'ready', epoch: 1 })
    expect(() => availability.assertSpawnAllowed('workspace-recovery', null)).not.toThrow()
  })

  it('does not expose the recovery capability to a normal spawn in the same async operation', async () => {
    const availability = new TerminalRuntimeAvailability()
    availability.completeStartup(['workspace-recovery', 'other-workspace'])

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

  it('keeps failed recovery unavailable and ignores a late completion after shutdown', async () => {
    const availability = new TerminalRuntimeAvailability()
    availability.completeStartup(['workspace-failed', 'workspace-closing'])

    await expect(
      availability.reconcileWorkspace('workspace-failed', async () => {
        throw new Error('reconciliation failed')
      }),
    ).rejects.toThrow('reconciliation failed')
    expect(availability.snapshot('workspace-failed')).toEqual({ phase: 'unavailable', epoch: 0 })

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

    expect(availability.snapshot('workspace-closing')).toEqual({
      phase: 'shutting-down',
      epoch: 0,
    })
  })
})
