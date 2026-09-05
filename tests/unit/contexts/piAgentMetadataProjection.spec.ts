import { describe, expect, it } from 'vitest'
import { projectPtyStreamAgentMetadata } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamAgentMetadataProjection'
import { normalizePiAgentSnapshot } from '../../../src/shared/runtime/piAgentSnapshot'
import { normalizeTerminalAgentActivitySnapshot } from '../../../src/shared/runtime/terminalAgentActivity'
import type { TerminalSessionMetadataEvent } from '../../../src/shared/contracts/dto'

function metadata(sequence: number, sessionId = 'a'): TerminalSessionMetadataEvent {
  return {
    sessionId: 'pty',
    agentProvider: 'pi',
    resumeSessionId: `/sessions/${sessionId}.jsonl`,
    piSnapshot: normalizePiAgentSnapshot({
      version: 1,
      pid: 123,
      sequence,
      conversationRevision: sequence,
      sessionId,
      sessionFile: `/sessions/${sessionId}.jsonl`,
      persistence: 'resumable',
      state: 'standby',
    })!,
  }
}

describe('Pi metadata projection', () => {
  it('accepts invocation completion carrying an unchanged retained Pi snapshot through replay layers', () => {
    const activity = {
      provider: 'pi' as const,
      invocationId: 'launch',
      generation: 1,
      phase: 'active' as const,
      observedAtMs: 1,
      identityAuthority: 'provider_session_snapshot' as const,
      sourceRevision: 1,
      revision: 1,
    }
    const previous = { ...metadata(1), terminalAgentActivity: activity }
    const ended = {
      ...previous,
      terminalAgentActivity: {
        ...activity,
        phase: 'exited' as const,
        sourceRevision: 2,
        revision: 2,
      },
    }
    expect(projectPtyStreamAgentMetadata(previous, ended)?.terminalAgentActivity?.phase).toBe(
      'exited',
    )
  })

  it('accepts native switches, rejects reordering, and fences discovery from the native binding', () => {
    const a = metadata(1)
    const b = projectPtyStreamAgentMetadata(a, metadata(3, 'b'))!
    expect(b.resumeSessionId).toBe('/sessions/b.jsonl')
    expect(projectPtyStreamAgentMetadata(b, metadata(2))).toBeNull()
    expect(
      projectPtyStreamAgentMetadata(b, { sessionId: 'pty', resumeSessionId: 'cwd-guess' }),
    ).toBeNull()
  })

  it('preserves Pi ordering across a terminal invocation while retaining other provider fences', () => {
    const activity = {
      provider: 'pi' as const,
      invocationId: 'launch',
      generation: 1,
      phase: 'active' as const,
      observedAtMs: 1,
      identityAuthority: 'provider_session_snapshot' as const,
      sourceRevision: 1,
      revision: 1,
    }
    const previous = { ...metadata(1), terminalAgentActivity: activity }
    const incoming = {
      sessionId: 'pty',
      agentProvider: 'pi' as const,
      resumeSessionId: null,
      terminalAgentActivity: { ...activity, sourceRevision: 2, revision: 2 },
    }
    expect(projectPtyStreamAgentMetadata(previous, incoming)?.resumeSessionId).toBeNull()
    expect(normalizeTerminalAgentActivitySnapshot(activity)).not.toBeNull()
    expect(normalizeTerminalAgentActivitySnapshot({ ...activity, provider: 'codex' })).toBeNull()
    expect(
      normalizeTerminalAgentActivitySnapshot({
        ...activity,
        revision: undefined,
        sourceRevision: undefined,
      }),
    ).toBeNull()
  })
})
