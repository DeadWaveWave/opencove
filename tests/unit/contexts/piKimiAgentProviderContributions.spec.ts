import { describe, expect, it, vi } from 'vitest'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { KimiAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/kimi/KimiAgentProviderContribution'
import { PiAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/pi/PiAgentProviderContribution'

const availability = (provider: 'pi' | 'kimi', command: string) => ({
  provider,
  command,
  status: 'available' as const,
  executablePath: `/usr/bin/${command}`,
  source: 'override' as const,
  diagnostics: [],
})

function launchCommand(overrides: Record<string, unknown> = {}) {
  return {
    artifacts: new AgentLaunchArtifactScope(),
    mode: 'new' as const,
    prompt: 'Explain the change',
    model: null,
    resumeSessionId: null,
    agentFullAccess: true,
    workspaceDirectory: '/tmp/workspace',
    ...overrides,
  }
}

describe('PiAgentProviderContribution', () => {
  it('owns executable detection and new launch semantics', async () => {
    const detector = { inspect: vi.fn(async () => availability('pi', 'pi')) }
    const provider = new PiAgentProviderContribution({ detector })

    await expect(provider.detector.inspect('/custom/pi')).resolves.toEqual(availability('pi', 'pi'))
    const plan = await provider.launcher.createLaunchPlan(
      launchCommand({ model: 'google/gemini-2.5-pro' }),
    )

    expect(detector.inspect).toHaveBeenCalledWith('/custom/pi')
    expect(plan).toEqual({
      args: ['--model', 'google/gemini-2.5-pro', 'Explain the change'],
      command: 'pi',
      effectiveModel: 'google/gemini-2.5-pro',
      env: {},
      launchMode: 'new',
      resumeSessionId: null,
    })
  })

  it('resumes an explicit session without inventing permission flags', async () => {
    const provider = new PiAgentProviderContribution()
    const plan = await provider.launcher.createLaunchPlan(
      launchCommand({
        mode: 'resume',
        model: 'anthropic/claude-sonnet-4',
        resumeSessionId: 'pi-session-id',
        agentFullAccess: false,
      }),
    )

    expect(plan.args).toEqual([
      '--model',
      'anthropic/claude-sonnet-4',
      '--session',
      'pi-session-id',
    ])
    expect(plan.args).not.toContain('--approve')
  })
})

describe('KimiAgentProviderContribution', () => {
  it('uses prompt mode only when the requested permission matches its forced auto mode', async () => {
    const detector = { inspect: vi.fn(async () => availability('kimi', 'kimi')) }
    const provider = new KimiAgentProviderContribution({ detector })
    const plan = await provider.launcher.createLaunchPlan(
      launchCommand({ model: 'kimi-for-coding' }),
    )

    expect(plan).toEqual({
      args: ['--model', 'kimi-for-coding', '--prompt', 'Explain the change'],
      command: 'kimi',
      effectiveModel: 'kimi-for-coding',
      env: {},
      launchMode: 'new',
      resumeSessionId: null,
    })
    expect(plan.args).not.toContain('--auto')
    expect(plan.args).not.toContain('--yolo')
  })

  it("refuses to escalate a safe initial prompt behind the user's back", async () => {
    const provider = new KimiAgentProviderContribution()

    await expect(
      provider.launcher.createLaunchPlan(launchCommand({ agentFullAccess: false })),
    ).rejects.toThrow('Kimi prompt mode requires full access')
  })

  it('uses interactive auto mode for resume and preserves explicit session ids', async () => {
    const provider = new KimiAgentProviderContribution()
    const plan = await provider.launcher.createLaunchPlan(
      launchCommand({
        mode: 'resume',
        model: 'kimi-for-coding',
        resumeSessionId: 'kimi-session-id',
      }),
    )

    expect(plan.args).toEqual([
      '--auto',
      '--model',
      'kimi-for-coding',
      '--session',
      'kimi-session-id',
    ])
  })
})
