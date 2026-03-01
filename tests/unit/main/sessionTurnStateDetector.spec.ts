import { describe, expect, it } from 'vitest'
import { detectTurnStateFromSessionLine } from '../../../src/main/infrastructure/session/SessionTurnStateDetector'

describe('detectTurnStateFromSessionLine', () => {
  it('detects claude assistant thinking chunks as working', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: null,
        content: [
          {
            type: 'thinking',
            thinking: 'Working...',
          },
        ],
      },
    })

    expect(detectTurnStateFromSessionLine('claude-code', line)).toBe('working')
  })

  it('detects claude assistant text chunks as standby', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: null,
        content: [
          {
            type: 'text',
            text: 'Done',
          },
        ],
      },
    })

    expect(detectTurnStateFromSessionLine('claude-code', line)).toBe('standby')
  })

  it('detects claude assistant tool use chunks as working', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: null,
        content: [
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'Bash',
          },
        ],
      },
    })

    expect(detectTurnStateFromSessionLine('claude-code', line)).toBe('working')
  })

  it('detects codex assistant message as standby', () => {
    const line = JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'All set.',
          },
        ],
      },
    })

    expect(detectTurnStateFromSessionLine('codex', line)).toBe('standby')
  })

  it('detects codex reasoning as working', () => {
    const line = JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [],
      },
    })

    expect(detectTurnStateFromSessionLine('codex', line)).toBe('working')
  })

  it('returns null for invalid JSON', () => {
    expect(detectTurnStateFromSessionLine('codex', '{invalid')).toBeNull()
  })

  it('ignores claude queue-operation events so standby is not overwritten', () => {
    const line = JSON.stringify({
      type: 'queue-operation',
      operation: 'dequeue',
    })

    expect(detectTurnStateFromSessionLine('claude-code', line)).toBeNull()
  })
})
