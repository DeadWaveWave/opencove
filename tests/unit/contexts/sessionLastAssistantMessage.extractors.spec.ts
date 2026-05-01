import { describe, expect, it } from 'vitest'
import { extractLastAssistantMessageFromSessionData } from '../../../src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage.extractors'

describe('extractLastAssistantMessageFromSessionData', () => {
  it('extracts Claude output_text content from proxy-shaped transcript records', () => {
    expect(
      extractLastAssistantMessageFromSessionData('claude-code', {
        type: 'assistant',
        message: {
          content: [{ type: 'output_text', text: 'All set.' }],
          stop_reason: null,
        },
      }),
    ).toBe('All set.')
  })

  it('extracts nested Claude structured text content', () => {
    expect(
      extractLastAssistantMessageFromSessionData('claude-code', {
        type: 'assistant',
        message: {
          content: [{ content: [{ text: 'Done from nested content.' }] }],
          stop_reason: 'end_turn',
        },
      }),
    ).toBe('Done from nested content.')
  })
})
