// @vitest-environment node
import { readFile, stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createPiHookChannel } from '../../../src/app/main/controlSurface/agentHook/piHookChannel'
import { PiAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/pi/PiAgentProviderContribution'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { piAgentStatusExtensionSource } from '../../../src/contexts/agent/infrastructure/providers/pi/PiAgentStatusExtension'

describe('Pi launch-scoped hook injection', () => {
  it('does not inject host credentials or extension paths into a WSL profile', async () => {
    const channel = createPiHookChannel()
    const provider = new PiAgentProviderContribution({ channel })
    const artifacts = new AgentLaunchArtifactScope()
    try {
      const plan = await provider.launcher.createLaunchPlan({
        artifacts,
        mode: 'new',
        model: null,
        resumeSessionId: null,
        agentFullAccess: false,
        workspaceDirectory: 'C:\\project',
        profileId: 'wsl:Ubuntu',
        prompt: 'hello',
      })
      expect(plan.args).toEqual(['hello'])
      expect(plan.env).toEqual({})
      expect(plan.hookInstallState).toBe('skipped')
      expect(channel.getEndpoint()).toBeNull()
    } finally {
      artifacts.seal()
      await artifacts.dispose()
      await channel.dispose()
    }
  })

  it('shares injection across managed launch and shell invocation and owns artifact cleanup', async () => {
    const channel = createPiHookChannel()
    const provider = new PiAgentProviderContribution({ channel })
    const artifacts = new AgentLaunchArtifactScope()
    try {
      const plan = await provider.launcher.createLaunchPlan({
        artifacts,
        mode: 'resume',
        model: null,
        resumeSessionId: '/custom/session.jsonl',
        agentFullAccess: false,
        workspaceDirectory: '/tmp/project',
      })
      expect(plan.args.slice(0, 1)).toEqual(['-e'])
      expect(plan.args.slice(2)).toEqual(['--session', '/custom/session.jsonl'])
      expect(await readFile(plan.args[1], 'utf8')).toBe(piAgentStatusExtensionSource)
      expect((await stat(plan.args[1])).mode & 0o777).toBe(0o600)
      expect(plan.env.OPENCOVE_PI_HOOK_TOKEN).toBeTruthy()
      expect(plan.hookInstallState).toBe('installed')
      plan.onStarted?.('pty')
      artifacts.seal()
      await artifacts.dispose()
      await expect(stat(plan.args[1])).rejects.toThrow()
    } finally {
      artifacts.seal()
      await artifacts.dispose()
      await channel.dispose()
    }
  })
})
