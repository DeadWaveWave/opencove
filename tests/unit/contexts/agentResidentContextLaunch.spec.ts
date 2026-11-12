// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  localCanvasResidentContext,
  canvasSpawnIdentity,
} from '../../../src/app/main/controlSurface/sessionSpawnIdentityContext'
import { resolveCanvasSpawnIdentity } from '../../../src/app/main/controlSurface/resolveCanvasSpawnIdentity'
import { CodexAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import { ClaudeCodeAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

it('uses trusted local canvas identity and rejects cwd-only and delegated remote identity', async () => {
  expect(localCanvasResidentContext()).toBe('none')
  const identity = { projectId: 'p', spaceId: 's', nodeId: 'n' }
  expect(canvasSpawnIdentity.run(identity, localCanvasResidentContext)).toBe('canvas')
  const delegated = await resolveCanvasSpawnIdentity(
    { requestAuth: { kind: 'bearer' } } as ControlSurfaceContext,
    { workerSpawnIdentity: identity },
    vi.fn(),
  )
  expect(delegated).toMatchObject({ ...identity, delegated: true })
  expect(canvasSpawnIdentity.run(delegated!, localCanvasResidentContext)).toBe('none')
})

it.each([
  ['claude', 'linux', true, 'canvas'],
  ['codex', 'linux', true, 'canvas'],
  ['codex', 'linux', false, 'none'],
  ['codex', 'win32', true, null],
] as const)(
  '%s %s lifecycle=%s reserves context=%s',
  async (provider, platform, lifecycle, expected) => {
    const reserve = vi.fn(async () => ({
      env: {},
      installState: 'installed',
      usesHook: true,
      commit() {},
      async dispose() {},
    }))
    const channel = {
      reserveSpawn: reserve,
      async start() {},
      getInstallState: () => 'installed',
    } as unknown as AgentHookChannel
    const artifacts = new AgentLaunchArtifactScope()
    const contribution =
      provider === 'claude'
        ? new ClaudeCodeAgentProviderContribution({ channel, runtimePlatform: platform })
        : new CodexAgentProviderContribution({
            channel,
            runtimePlatform: platform,
            hookTrustResolver: async () => (lifecycle ? 'hooks.state={}' : null),
            sessionDiscovery: { reserve: () => ({ start() {}, async dispose() {} }) } as never,
          })
    try {
      await contribution.hookInjection.prepareHookInjection({
        residentContext: 'canvas',
        workspaceDirectory: '/tmp',
        artifacts,
      })
      if (expected === null) {
        expect(reserve).not.toHaveBeenCalled()
      } else {
        expect(reserve).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ residentContext: expected }),
        )
      }
    } finally {
      await artifacts.dispose()
    }
  },
)
