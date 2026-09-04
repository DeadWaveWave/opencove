import { describe, expect, it, vi } from 'vitest'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { AgentLaunchSessionRegistrationOwner } from '../../../src/contexts/agent/application/services/AgentLaunchSessionRegistrationOwner'

describe('AgentLaunchSessionRegistrationOwner', () => {
  it('retires the exact session when synchronous post-spawn registration fails', async () => {
    const owner = new AgentLaunchSessionRegistrationOwner(() => undefined)
    const artifacts = new AgentLaunchArtifactScope()
    const disposeArtifact = vi.fn(async () => undefined)
    artifacts.track('registration-failure-artifact', { dispose: disposeArtifact })
    artifacts.seal()
    const retireExact = vi.fn(async () => undefined)

    await expect(
      owner.spawn({
        spawn: async () => ({ sessionId: 'registration-failure-session' }),
        artifacts,
        onRegistered: () => {
          throw new Error('registration failed')
        },
        retireExact,
      }),
    ).rejects.toThrow('registration failed')
    expect(retireExact).toHaveBeenCalledExactlyOnceWith('registration-failure-session')
    await vi.waitFor(() => expect(disposeArtifact).toHaveBeenCalledTimes(1))
  })

  it('retires only the exact late session and rolls back artifacts after disposal', async () => {
    const owner = new AgentLaunchSessionRegistrationOwner(() => undefined)
    const artifacts = new AgentLaunchArtifactScope()
    const disposeArtifact = vi.fn(async () => undefined)
    artifacts.track('late-agent-artifact', { dispose: disposeArtifact })
    artifacts.seal()
    const retireExact = vi.fn(async () => undefined)
    let resolveSpawn!: (value: { sessionId: string }) => void

    const spawning = owner.spawn({
      spawn: async () =>
        await new Promise<{ sessionId: string }>(resolve => {
          resolveSpawn = resolve
        }),
      artifacts,
      onRegistered: vi.fn(),
      retireExact,
    })
    owner.dispose()
    resolveSpawn({ sessionId: 'late-agent-session' })

    await expect(spawning).rejects.toThrow('lost its owner before spawn registration')
    expect(retireExact).toHaveBeenCalledExactlyOnceWith('late-agent-session')
    expect(disposeArtifact).toHaveBeenCalledTimes(1)
  })
})
