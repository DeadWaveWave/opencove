import { expect, it } from 'vitest'
import type { TerminalNodeData } from '../types'
import type { AgentRunSnapshot } from '@shared/contracts/dto/agentRunState'
import { projectAgentRuntimeObservation } from './agentRuntimeObservation'

it('refreshes the UI reason within waiting without persisting dialog text', () => {
  const data = { kind: 'agent', status: 'running' } as TerminalNodeData
  const snapshot: AgentRunSnapshot = {
    sessionId: 's',
    nodeId: 'n',
    provider: 'claude-code',
    turn: null,
    lastTransitionAt: 0,
    source: 'claude_hook',
    quality: 'authoritative',
    turnOutcome: null,
    lastEndedTurn: null,
    state: 'waiting',
    blockedReason: 'question',
    blockedSummary: { kind: 'question', questions: [{ question: 'UNTRUSTED', options: [] }] },
  }
  const input = {
    state: 'waiting' as const,
    source: 'claude_hook' as const,
    agentRunState: snapshot,
  }
  const first = projectAgentRuntimeObservation(data, input)!
  expect(first.durableDidChange).toBe(false)
  expect(first.data.agentRuntimeObservation?.blockedReason).toBe('question')
  expect(JSON.stringify(first.data)).not.toContain('UNTRUSTED')
  expect(projectAgentRuntimeObservation(first.data, input)).toBeNull()
  const second = projectAgentRuntimeObservation(first.data, {
    ...input,
    agentRunState: { ...snapshot, blockedReason: 'permission' },
  })!
  expect(second.data.agentRuntimeObservation?.blockedReason).toBe('permission')
  const resolved = projectAgentRuntimeObservation(second.data, {
    state: 'standby',
    source: 'claude_hook',
    agentRunState: { ...snapshot, state: 'idle', blockedReason: null, blockedSummary: null },
  })!
  expect(resolved.data.agentRuntimeObservation?.blockedReason).toBeUndefined()
  expect(resolved.durableDidChange).toBe(false)
})
