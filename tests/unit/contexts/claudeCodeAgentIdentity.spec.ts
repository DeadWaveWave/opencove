import { describe, expect, it } from 'vitest'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { ClaudeCodeAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'

describe('managed Claude launch identity', () => {
  it('assigns different explicit UUIDs to concurrent new launches in the same directory', async () => {
    const provider = new ClaudeCodeAgentProviderContribution()
    const artifacts = new AgentLaunchArtifactScope()
    try {
      const command = {
        artifacts,
        mode: 'new' as const,
        model: null,
        // A new launch must not reuse an ID retained from an earlier run.
        resumeSessionId: '11111111-1111-4111-8111-111111111111',
        agentFullAccess: false,
        workspaceDirectory: '/tmp/shared-workspace',
        prompt: '- explain the change',
      }
      const plans = await Promise.all([
        provider.launcher.createLaunchPlan(command),
        provider.launcher.createLaunchPlan(command),
      ])

      for (const plan of plans) {
        expect(plan.resumeSessionId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        )
        expect(plan.resumeSessionId).not.toBe(command.resumeSessionId)
        expect(plan.launchMode).toBe('new')
        expect(plan.args).toEqual([
          '--permission-mode',
          'default',
          '--session-id',
          plan.resumeSessionId,
          '--',
          command.prompt,
        ])
      }
      expect(plans[0]?.resumeSessionId).not.toBe(plans[1]?.resumeSessionId)
    } finally {
      await artifacts.dispose()
    }
  })

  it('retains the explicit session ID when resuming', async () => {
    const provider = new ClaudeCodeAgentProviderContribution()
    const artifacts = new AgentLaunchArtifactScope()
    const resumeSessionId = '22222222-2222-4222-8222-222222222222'
    try {
      const plan = await provider.launcher.createLaunchPlan({
        artifacts,
        mode: 'resume',
        model: null,
        resumeSessionId,
        agentFullAccess: false,
        workspaceDirectory: '/tmp/shared-workspace',
      })

      expect(plan.resumeSessionId).toBe(resumeSessionId)
      expect(plan.launchMode).toBe('resume')
      expect(plan.args).toEqual(['--permission-mode', 'default', '--resume', resumeSessionId])
    } finally {
      await artifacts.dispose()
    }
  })
})
