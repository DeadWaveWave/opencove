import { describe, expect, it, vi } from 'vitest'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { CodexAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'

describe('Windows Codex session file policy', () => {
  it('launches without reserving hooks, querying trust, or overriding user configuration', async () => {
    const reserveSpawn = vi.fn(async () => {
      throw new Error('hook preparation must not run')
    })
    const hookTrustResolver = vi.fn(async () => {
      throw new Error('app-server must not start')
    })
    const provider = new CodexAgentProviderContribution({
      runtimePlatform: 'win32',
      channel: { reserveSpawn } as unknown as AgentHookChannel,
      hookTrustResolver,
    })
    const artifacts = new AgentLaunchArtifactScope()
    try {
      const plan = await provider.launcher.createLaunchPlan({
        artifacts,
        mode: 'resume',
        resumeSessionId: 'saved-session',
        model: null,
        agentFullAccess: false,
        workspaceDirectory: process.cwd(),
      })
      expect(plan.args).toEqual([
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'on-request',
        'resume',
        'saved-session',
      ])
      expect(plan.env).toEqual({})
      expect(plan.hookInstallState).toBe('not_required')
      expect(reserveSpawn).not.toHaveBeenCalled()
      expect(hookTrustResolver).not.toHaveBeenCalled()
    } finally {
      artifacts.seal()
      await artifacts.dispose()
    }
  })
})
