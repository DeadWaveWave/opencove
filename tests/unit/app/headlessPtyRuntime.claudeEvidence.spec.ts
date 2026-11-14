// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createHeadlessPtyRuntime } from '../../../src/app/worker/headlessPtyRuntime'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'
import {
  getPromptSubmissionEvidence,
  setPromptSubmissionEvidence,
} from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'

const captured = vi.hoisted(() => ({
  state: undefined as ((event: TerminalSessionStateEvent) => void) | undefined,
  transcript: undefined as ((record: ClaudeTranscriptObservation) => void) | undefined,
}))
vi.mock('../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcher', () => ({
  createSessionStateWatcherController: vi.fn(options => {
    captured.state = options.onState
    captured.transcript = options.onClaudeTranscript
    return { start() {}, noteInteraction() {}, disposeSession() {}, dispose() {} }
  }),
}))
it('preserves captured private watcher evidence through Headless enrichment without exposing it in DTOs', async () => {
  const runtime = createHeadlessPtyRuntime({ processEngine: new FakeTerminalProcessEngine() })
  const observed: TerminalSessionStateEvent[] = []
  runtime.onState(event => observed.push(event))
  try {
    const input: TerminalSessionStateEvent = {
      sessionId: 's',
      source: 'session_file',
      state: 'standby',
      degraded: true,
    }
    setPromptSubmissionEvidence(input, { providerSessionId: 'A', conversationGeneration: 7 })
    captured.state?.(input)
    expect(observed).toHaveLength(1)
    expect(observed[0]).not.toBe(input)
    expect(getPromptSubmissionEvidence(observed[0])).toMatchObject({
      providerSessionId: 'A',
      conversationGeneration: 7,
    })
    expect(JSON.stringify(observed[0])).not.toMatch(/providerSessionId|conversationGeneration/)
  } finally {
    await runtime.dispose()
  }
})
it('routes synchronous watcher generation capture to the executing registry subscriber', async () => {
  const runtime = createHeadlessPtyRuntime({ processEngine: new FakeTerminalProcessEngine() })
  let generation: number | undefined
  runtime.onClaudeTranscript?.(record => record.captureConversation?.(7))
  try {
    captured.transcript?.({
      sessionId: 's',
      incarnation: 's',
      providerSessionId: 'A',
      generation: 1,
      fileIdentity: 'capture',
      position: -1,
      baseline: true,
      captureConversation: value => {
        generation = value
      },
    })
    expect(generation).toBe(7)
  } finally {
    await runtime.dispose()
  }
})
