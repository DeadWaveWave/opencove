import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PI_SUPPORTED_SESSION_VERSION,
  detectPiSessionState,
} from '../../../src/contexts/agent/infrastructure/watchers/PiSessionStateDetector'

function session(...records: unknown[]): string {
  return records.map(record => JSON.stringify(record)).join('\n')
}

const header = {
  type: 'session',
  version: PI_SUPPORTED_SESSION_VERSION,
  id: 'session-redacted',
  cwd: '/workspace',
}

describe('detectPiSessionState', () => {
  it('maps pi user, tool-loop, and final assistant records to turn state', () => {
    const toolCall = {
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'tool-redacted', name: 'read', arguments: {} }],
        stopReason: 'toolUse',
      },
    }
    const toolResult = {
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: 'tool-redacted',
        toolName: 'read',
        content: [{ type: 'text', text: '<redacted>' }],
        isError: false,
      },
    }
    const finalAssistant = {
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '<redacted>' }],
        stopReason: 'stop',
      },
    }

    expect(
      detectPiSessionState(session(header, { type: 'message', message: { role: 'user' } })),
    ).toEqual({ kind: 'observed', state: 'working' })
    expect(detectPiSessionState(session(header, toolCall))).toEqual({
      kind: 'observed',
      state: 'working',
    })
    expect(detectPiSessionState(session(header, toolCall, toolResult))).toEqual({
      kind: 'observed',
      state: 'working',
    })
    expect(detectPiSessionState(session(header, toolResult))).toEqual({
      kind: 'observed',
      state: 'working',
    })
    expect(detectPiSessionState(session(header, toolCall, toolResult, finalAssistant))).toEqual({
      kind: 'observed',
      state: 'standby',
    })
  })

  it('does not misread the common mixed toolResult role as assistant completion', () => {
    const content = session(
      header,
      { type: 'message', message: { role: 'user' } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall' }],
          stopReason: 'toolUse',
        },
      },
      { type: 'message', message: { role: 'toolResult', isError: false } },
      { type: 'model_change', provider: 'synthetic', modelId: 'synthetic' },
    )

    expect(detectPiSessionState(content)).toEqual({ kind: 'observed', state: 'working' })
  })

  it('uses a redacted fixture derived from real pi v3 session shapes', () => {
    const content = readFileSync(resolve('tests/fixtures/agent/pi-session-redacted.jsonl'), 'utf8')

    expect(content).not.toMatch(/\/Users\/|shihaojie/u)
    expect(detectPiSessionState(content)).toEqual({ kind: 'observed', state: 'standby' })
  })

  it('keeps missing, malformed, and unsupported evidence distinct from standby', () => {
    expect(detectPiSessionState(null)).toEqual({ kind: 'unobservable', reason: 'missing' })
    expect(detectPiSessionState(' \n')).toEqual({ kind: 'unobservable', reason: 'empty' })
    expect(detectPiSessionState('<unparsable>')).toEqual({
      kind: 'unobservable',
      reason: 'unparsable',
    })
    expect(
      detectPiSessionState(
        session(
          { ...header, version: PI_SUPPORTED_SESSION_VERSION + 1 },
          { type: 'message', message: { role: 'user' } },
        ),
      ),
    ).toEqual({ kind: 'unobservable', reason: 'version_unsupported' })
    expect(
      detectPiSessionState(
        session(header, { type: 'thinking_level_change', thinkingLevel: 'low' }),
      ),
    ).toEqual({ kind: 'unobservable', reason: 'state_unavailable' })
  })
})
