import { afterEach, describe, expect, it, vi } from 'vitest'
import { listAgentModels } from '../../../src/main/infrastructure/agent/AgentModelService'

const ORIGINAL_ENV = { ...process.env }
const DEFAULT_MOCK_DATA = {
  data: [
    {
      id: 'claude-sonnet-4-5',
      display_name: 'Claude Sonnet 4.5',
    },
  ],
}

function createMockFetch(): typeof fetch {
  return vi.fn(async () => {
    return {
      ok: true,
      json: async () => DEFAULT_MOCK_DATA,
      text: async () => '',
    } as Response
  }) as unknown as typeof fetch
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

describe('AgentModelService claude model list', () => {
  it('uses ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY when provided', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com/'
    process.env.ANTHROPIC_API_KEY = 'proxy-key'
    process.env.CLAUDE_CODE_BASE_URL = 'https://ignored.example.com'
    process.env.CLAUDE_CODE_API_KEY = 'ignored-key'

    const fetchMock = createMockFetch()
    globalThis.fetch = fetchMock

    const result = await listAgentModels('claude-code')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'proxy-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    )

    expect(result.error).toBeNull()
    expect(result.models[0]?.id).toBe('claude-sonnet-4-5')
  })

  it('falls back to CLAUDE_CODE_BASE_URL and CLAUDE_CODE_API_KEY', async () => {
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_API_KEY
    process.env.CLAUDE_CODE_BASE_URL = 'https://gateway.internal'
    process.env.CLAUDE_CODE_API_KEY = 'gateway-key'

    const fetchMock = createMockFetch()
    globalThis.fetch = fetchMock

    const result = await listAgentModels('claude-code')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.internal/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'gateway-key',
        }),
      }),
    )
    expect(result.error).toBeNull()
  })

  it('uses default anthropic endpoint when base url is unset', async () => {
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.CLAUDE_BASE_URL
    delete process.env.CLAUDE_CODE_BASE_URL
    delete process.env.ANTHROPIC_API_BASE_URL
    process.env.CLAUDE_API_KEY = 'plain-key'

    const fetchMock = createMockFetch()
    globalThis.fetch = fetchMock

    const result = await listAgentModels('claude-code')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'plain-key',
        }),
      }),
    )
    expect(result.error).toBeNull()
  })
})
