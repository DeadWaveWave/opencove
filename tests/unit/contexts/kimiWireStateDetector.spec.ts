import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KIMI_WIRE_SUPPORTED_PROTOCOL_MAJOR,
  detectKimiWireState,
} from '../../../src/contexts/agent/infrastructure/watchers/KimiWireStateDetector'

function wire(...records: unknown[]): string {
  return records.map(record => JSON.stringify(record)).join('\n')
}

const metadata = {
  type: 'metadata',
  protocol_version: `${KIMI_WIRE_SUPPORTED_PROTOCOL_MAJOR}.4`,
}

const working = {
  type: 'context.append_loop_event',
  event: { type: 'step.begin', turnId: 'redacted', step: 1 },
}

const standby = {
  type: 'context.append_loop_event',
  event: { type: 'step.end', turnId: 'redacted', step: 1, finishReason: 'end_turn' },
}

describe('detectKimiWireState', () => {
  it('INV-B6 never reports waiting for a result-side permission event', () => {
    const result = detectKimiWireState(
      wire(metadata, working, {
        type: 'permission.record_approval_result',
        turnId: 0,
        result: { decision: 'approved', scope: 'once' },
      }),
    )

    expect(result).toEqual({ kind: 'observed', state: 'working' })
    expect(JSON.stringify(result)).not.toContain('waiting')
  })

  it('INV-B7 distinguishes missing, unparsable, and unsupported evidence from standby', () => {
    expect(detectKimiWireState(null)).toEqual({
      kind: 'unobservable',
      reason: 'missing',
    })
    expect(detectKimiWireState('  \n')).toEqual({
      kind: 'unobservable',
      reason: 'empty',
    })
    expect(detectKimiWireState('<unparsable>\nstill not json')).toEqual({
      kind: 'unobservable',
      reason: 'unparsable',
    })
    expect(
      detectKimiWireState(wire({ type: 'metadata', protocol_version: '2.0' }, standby)),
    ).toEqual({
      kind: 'unobservable',
      reason: 'protocol_unsupported',
    })
  })

  it('INV-B7 requires valid protocol metadata and an observable state event', () => {
    expect(detectKimiWireState(wire({ type: 'config.update' }, working))).toEqual({
      kind: 'unobservable',
      reason: 'metadata_missing',
    })
    expect(detectKimiWireState(wire({ type: 'metadata', protocol_version: 1.4 }, working))).toEqual(
      {
        kind: 'unobservable',
        reason: 'metadata_invalid',
      },
    )
    expect(detectKimiWireState(wire(metadata, { type: 'config.update' }))).toEqual({
      kind: 'unobservable',
      reason: 'state_unavailable',
    })
  })

  it('INV-B8 skips a malformed line and continues through a redacted real-wire fixture', () => {
    const content = readFileSync(resolve('tests/fixtures/agent/kimi-wire-redacted.jsonl'), 'utf8')

    expect(content).toContain('<unparsable>')
    expect(content).not.toMatch(/systemPrompt|\/Users\/|shihaojie/u)
    expect(detectKimiWireState(content)).toEqual({ kind: 'observed', state: 'standby' })
  })

  it('INV-B9 uses the newest state-bearing event, not the oldest', () => {
    expect(detectKimiWireState(wire(metadata, working, standby))).toEqual({
      kind: 'observed',
      state: 'standby',
    })
    expect(detectKimiWireState(wire(metadata, standby, working))).toEqual({
      kind: 'observed',
      state: 'working',
    })
  })

  it('keeps the latest state across non-state bookkeeping records', () => {
    expect(
      detectKimiWireState(
        wire(metadata, standby, { type: 'usage.record', usage: { inputOther: 1, output: 1 } }),
      ),
    ).toEqual({ kind: 'observed', state: 'standby' })
  })

  it.each([
    { type: 'turn.prompt' },
    { type: 'turn.steer' },
    { type: 'llm.request' },
    { type: 'context.append_message', message: { role: 'user', content: [] } },
    { type: 'context.append_loop_event', event: { type: 'content.part' } },
    { type: 'context.append_loop_event', event: { type: 'tool.call' } },
    { type: 'context.append_loop_event', event: { type: 'tool.result' } },
    {
      type: 'context.append_loop_event',
      event: { type: 'step.end', finishReason: 'tool_use' },
    },
  ])('maps active wire record $type to working', record => {
    expect(detectKimiWireState(wire(metadata, record))).toEqual({
      kind: 'observed',
      state: 'working',
    })
  })

  it('maps turn cancellation to standby', () => {
    expect(detectKimiWireState(wire(metadata, working, { type: 'turn.cancel' }))).toEqual({
      kind: 'observed',
      state: 'standby',
    })
  })
})
