// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { PiAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/pi/PiAgentProviderContribution'
import { createManagedAgentLaunchPlan } from '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan'

const file = vi.hoisted(() => ({ path: '', dispose: vi.fn(async () => {}) }))
vi.mock(
  '../../../src/contexts/agent/infrastructure/providers/shared/TemporaryProviderConfig',
  () => ({
    createTemporaryProviderConfig: async () => file,
  }),
)
afterEach(() => {
  vi.clearAllMocks()
})
it.each(['powershell', 'wsl:Ubuntu', ' WSL:Ubuntu ', 'wsl:RemovedDistro'])(
  'refuses unsafe Pi text before %s wrapping or artifact creation',
  async profileId => {
    await expect(
      createManagedAgentLaunchPlan(new PiAgentProviderContribution(), {
        profileId,
        mode: 'new',
        prompt: '--approve',
        model: null,
        resumeSessionId: null,
        agentFullAccess: false,
        workspaceDirectory: 'C:\\project',
      }),
    ).rejects.toMatchObject({ details: { reason: 'initial_prompt_unsupported' } })
    expect(file.dispose).not.toHaveBeenCalled()
  },
)
