import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceNodeKind } from '../../types'
import { resolveWorkspaceMinimapNodeColor } from './minimap'

function node(
  kind: WorkspaceNodeKind,
  extra: Partial<TerminalNodeData> = {},
): Node<TerminalNodeData> {
  return {
    id: kind,
    position: { x: 0, y: 0 },
    data: { kind, status: null, agent: null, ...extra },
  } as Node<TerminalNodeData>
}

describe('resolveWorkspaceMinimapNodeColor', () => {
  it('paints windows in the same kind families as their header tiles', () => {
    expect(resolveWorkspaceMinimapNodeColor(node('agent'))).toBe('var(--cove-minimap-kind-ai)')
    expect(resolveWorkspaceMinimapNodeColor(node('role'))).toBe('var(--cove-minimap-kind-ai)')
    expect(resolveWorkspaceMinimapNodeColor(node('terminal'))).toBe(
      'var(--cove-minimap-kind-shell)',
    )
    expect(resolveWorkspaceMinimapNodeColor(node('task'))).toBe('var(--cove-minimap-kind-plan)')
    expect(resolveWorkspaceMinimapNodeColor(node('note'))).toBe(
      'var(--cove-minimap-kind-knowledge)',
    )
    expect(resolveWorkspaceMinimapNodeColor(node('website'))).toBe('var(--cove-minimap-kind-media)')
    expect(resolveWorkspaceMinimapNodeColor(node('folder'))).toBe(
      'var(--cove-minimap-kind-neutral)',
    )
  })

  it('counts an agent running in a terminal as AI', () => {
    expect(
      resolveWorkspaceMinimapNodeColor(
        node('terminal', {
          agentOverlay: { provider: 'codex', status: 'running' },
        } as Partial<TerminalNodeData>),
      ),
    ).toBe('var(--cove-minimap-kind-ai)')
  })
})
