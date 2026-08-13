import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listInstalledAgentProviders } from '../../../src/contexts/agent/infrastructure/cli/AgentCliAvailability'
import type { AgentProviderId } from '../../../src/shared/contracts/dto'

const resolveAgentProviderAvailabilityMock = vi.hoisted(() => vi.fn())

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentExecutableResolver', () => ({
  resolveAgentProviderAvailability: resolveAgentProviderAvailabilityMock,
}))

describe('listInstalledAgentProviders', () => {
  beforeEach(() => {
    resolveAgentProviderAvailabilityMock.mockImplementation(
      async ({ provider }: { provider: AgentProviderId }) => ({
        provider,
        command: provider === 'claude-code' ? 'claude' : provider,
        status: 'available',
        executablePath: `/usr/local/bin/${provider}`,
        source: 'process_path',
        diagnostics: [],
      }),
    )
  })

  it('reports only providers offered by new-agent selection surfaces', async () => {
    const result = await listInstalledAgentProviders()

    expect(
      resolveAgentProviderAvailabilityMock.mock.calls.map(([input]) => input.provider),
    ).toEqual(['claude-code', 'codex', 'opencode'])
    expect(result.providers).toEqual(['claude-code', 'codex', 'opencode'])
    expect(result.availabilityByProvider.gemini).toBeUndefined()
  })
})
