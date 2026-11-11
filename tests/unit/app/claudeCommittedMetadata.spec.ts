import { expect, it, vi } from 'vitest'
import {
  projectCommittedClaudeBinding,
  registerPtyStreamAgentMetadata,
} from '../../../src/app/main/controlSurface/ptyStream/ptyStreamAgentMetadataProjection'
import type { SessionState } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamState'
import type { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
it('projects a committed target after exit without touching active run identity and fences ordinary replay', () => {
  const session = {
    status: 'exited',
    agentMetadata: { sessionId: 'r', agentProvider: 'claude-code', resumeSessionId: 'A' },
  } as SessionState
  const metadata = vi.fn(),
    broadcast = vi.fn()
  const runs = { metadata } as unknown as AgentRunStateRuntime
  projectCommittedClaudeBinding(session, 'B', broadcast)
  expect(session.agentMetadata?.resumeSessionId).toBe('B')
  expect(broadcast).toHaveBeenCalledOnce()
  expect(metadata).not.toHaveBeenCalled()
  session.status = 'running'
  registerPtyStreamAgentMetadata(
    session,
    { sessionId: 'r', resumeSessionId: 'A', agentProvider: 'claude-code' },
    runs,
    broadcast,
  )
  expect(session.agentMetadata?.resumeSessionId).toBe('B')
  expect(metadata).not.toHaveBeenCalled()
})
