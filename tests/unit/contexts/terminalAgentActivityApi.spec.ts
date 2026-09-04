import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalAgentActivityApi,
  parseTerminalAgentActivityMetadataResult,
} from '../../../src/contexts/terminal/presentation/renderer/terminalAgentActivityApi'

function entry(sessionId = 'session-1', revision = 1) {
  return {
    sessionId,
    resumeSessionId: 'provider-session-1',
    terminalAgentActivity: {
      provider: 'codex' as const,
      invocationId: 'invocation-1',
      generation: 1,
      phase: 'active' as const,
      observedAtMs: 1_000,
      identityAuthority: 'provider_session_start' as const,
      sourceRevision: revision,
      revision,
    },
  }
}

describe('terminal Agent activity presentation API', () => {
  it('uses the query-only Control Surface operation and validates its result', async () => {
    const invoke = vi.fn(async () => ({ entries: [entry()] }))
    const api = createTerminalAgentActivityApi({ invoke })

    await expect(api.listLatestMetadata()).resolves.toEqual([entry()])
    expect(invoke).toHaveBeenCalledWith({
      kind: 'query',
      id: 'session.terminalAgentActivity.list',
      payload: null,
    })
  })

  it.each([
    null,
    {},
    { entries: null },
    { entries: [{}] },
    {
      entries: [
        {
          ...entry(),
          terminalAgentActivity: { ...entry().terminalAgentActivity, revision: undefined },
        },
      ],
    },
    { entries: [entry('duplicate'), entry(' duplicate ', 2)] },
  ])('rejects a malformed result without partially accepting it', value => {
    expect(() => parseTerminalAgentActivityMetadataResult(value)).toThrow(
      'Invalid terminal Agent activity baseline',
    )
  })

  it('normalizes boundary identifiers without changing observation time', () => {
    expect(
      parseTerminalAgentActivityMetadataResult({
        entries: [
          {
            ...entry(' session-trimmed '),
            resumeSessionId: ' provider-session-trimmed ',
          },
        ],
      }),
    ).toEqual({
      entries: [
        {
          ...entry('session-trimmed'),
          resumeSessionId: 'provider-session-trimmed',
        },
      ],
    })
  })
})
