import { describe, expect, it } from 'vitest'
import { toAgentSessionDisplaySummary } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/agentSessionDisplay'
import type { AgentSessionSummary } from '../../../src/shared/contracts/dto'

function createSummary(overrides: Partial<AgentSessionSummary>): AgentSessionSummary {
  return {
    sessionId: 'session-1',
    provider: 'codex',
    cwd: '/tmp/repo',
    title: null,
    preview: null,
    startedAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:10:00.000Z',
    source: 'codex-file',
    ...overrides,
  }
}

describe('toAgentSessionDisplaySummary', () => {
  it('prefers title and keeps session id as subtitle when preview is missing', () => {
    expect(
      toAgentSessionDisplaySummary(
        createSummary({
          title: 'Fix session UX',
        }),
      ),
    ).toEqual({
      title: 'Fix session UX',
      subtitle: 'session-1',
      identity: null,
    })
  })

  it('shows preview as subtitle and preserves session id as identity when title differs', () => {
    expect(
      toAgentSessionDisplaySummary(
        createSummary({
          title: 'Fix session UX',
          preview: 'Investigate why the picker is hard to scan',
        }),
      ),
    ).toEqual({
      title: 'Fix session UX',
      subtitle: 'Investigate why the picker is hard to scan',
      identity: 'session-1',
    })
  })

  it('deduplicates preview when it matches the title', () => {
    expect(
      toAgentSessionDisplaySummary(
        createSummary({
          title: 'Investigate session UX',
          preview: 'Investigate session UX',
        }),
      ),
    ).toEqual({
      title: 'Investigate session UX',
      subtitle: 'session-1',
      identity: null,
    })
  })

  it('uses preview as the main title when provider title is absent', () => {
    expect(
      toAgentSessionDisplaySummary(
        createSummary({
          preview: 'Reload the agent after changing env vars',
        }),
      ),
    ).toEqual({
      title: 'Reload the agent after changing env vars',
      subtitle: 'session-1',
      identity: null,
    })
  })

  it('falls back to session id when no semantic summary exists', () => {
    expect(toAgentSessionDisplaySummary(createSummary({}))).toEqual({
      title: 'session-1',
      subtitle: null,
      identity: null,
    })
  })
})
