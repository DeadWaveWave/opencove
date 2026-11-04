import { describe, expect, it } from 'vitest'
import type { TerminalNodeData, WorkspaceNodeKind } from '../types'
import { resolveWindowKindFamily } from './windowKindFamily'

function data(kind: WorkspaceNodeKind, extra: Partial<TerminalNodeData> = {}): TerminalNodeData {
  return { kind, status: null, agent: null, ...extra } as TerminalNodeData
}

describe('resolveWindowKindFamily', () => {
  it('groups window kinds into the five colour families', () => {
    expect(resolveWindowKindFamily(data('agent'))).toBe('ai')
    expect(resolveWindowKindFamily(data('role'))).toBe('ai')
    expect(resolveWindowKindFamily(data('terminal'))).toBe('shell')
    expect(resolveWindowKindFamily(data('task'))).toBe('plan')
    expect(resolveWindowKindFamily(data('note'))).toBe('knowledge')
    expect(resolveWindowKindFamily(data('document'))).toBe('knowledge')
    expect(resolveWindowKindFamily(data('website'))).toBe('media')
    expect(resolveWindowKindFamily(data('image'))).toBe('media')
    expect(resolveWindowKindFamily(data('folder'))).toBe('neutral')
    expect(resolveWindowKindFamily(data('plugin'))).toBe('neutral')
  })

  it('treats an agent running inside a terminal as AI', () => {
    expect(
      resolveWindowKindFamily(
        data('terminal', {
          agentOverlay: { provider: 'claude-code', status: 'running' },
        } as Partial<TerminalNodeData>),
      ),
    ).toBe('ai')
  })
})
