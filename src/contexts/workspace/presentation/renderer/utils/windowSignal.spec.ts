import { describe, expect, it } from 'vitest'
import type { TerminalNodeData } from '../types'
import { resolveWindowSignal } from './windowSignal'

const data = (kind: TerminalNodeData['kind'], status: TerminalNodeData['status']) =>
  ({ kind, status, title: kind, width: 1, height: 1, agent: null }) as TerminalNodeData

describe('window signal', () => {
  it('maps agent states to working, waiting or failed, and keeps standby quiet', () => {
    expect(resolveWindowSignal(data('agent', null))).toBe('working')
    expect(resolveWindowSignal(data('agent', 'running'))).toBe('working')
    expect(resolveWindowSignal(data('agent', 'restoring'))).toBe('working')
    expect(resolveWindowSignal(data('agent', 'waiting'))).toBe('waiting')
    expect(resolveWindowSignal(data('agent', 'failed'))).toBe('failed')
    expect(resolveWindowSignal(data('agent', 'standby'))).toBeNull()
  })

  it('never signals for windows that are not agents', () => {
    expect(resolveWindowSignal(data('note', 'running'))).toBeNull()
    expect(resolveWindowSignal(data('terminal', null))).toBeNull()
  })
})
