import { expect, it, vi } from 'vitest'
import { AGENT_PROVIDER_IDS } from '../../../src/shared/contracts/dto'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import { createManagedAgentLaunchPlan } from '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan'
import { assertSessionGrantMessagePrompt } from '../../../src/app/main/controlSurface/http/sessionGrantPromptPolicy'
import { checkSessionGrantLaunch } from '../../../src/app/main/controlSurface/http/sessionGrantLaunchPolicy'
import type { GrantCheckDeps } from '../../../src/app/main/controlSurface/http/sessionGrantPolicy'

it.each([undefined, ...AGENT_PROVIDER_IDS])(
  'grant admission refuses NUL for %s before resolving a target',
  provider => {
    expect(() =>
      assertSessionGrantMessagePrompt('plugins\0 explain this project', {
        provider,
        operationId: 'agent.prompt',
        field: 'text',
      }),
    ).toThrow()
  },
)
it('generic grant launch admission refuses a NUL sentence', () => {
  expect(() =>
    checkSessionGrantLaunch({ prompt: 'plugins\0 explain this project' }, {
      operationId: 'session.launchAgent',
      wirePayload: { prompt: 'plugins\0 explain this project' },
    } as GrantCheckDeps),
  ).toThrow()
})
it.each(createBuiltinAgentProviderContributions())(
  'shared planner preflights NUL before invoking $descriptor.id launcher',
  async contribution => {
    const createLaunchPlan = vi.fn(contribution.launcher.createLaunchPlan)
    const provider = { ...contribution, launcher: { ...contribution.launcher, createLaunchPlan } }
    await expect(
      createManagedAgentLaunchPlan(provider, {
        mode: 'new',
        prompt: 'plugins\0 explain this project',
        resumeSessionId: null,
        model: null,
        agentFullAccess: false,
        workspaceDirectory: '/tmp',
      }),
    ).rejects.toMatchObject({ code: 'common.invalid_input' })
    expect(createLaunchPlan).not.toHaveBeenCalled()
  },
)
