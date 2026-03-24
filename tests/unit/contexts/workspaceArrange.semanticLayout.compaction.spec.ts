import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import type { WorkspaceArrangeSemanticGroup } from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceArrange.semantic'
import { resolveWorkspaceArrangeSemanticGridPlacements } from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceArrange.semanticLayout'

function makeNode(id: string, kind: TerminalNodeData['kind']): Node<TerminalNodeData> {
  return {
    id,
    type: 'terminalNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId: '',
      title: id,
      width: 0,
      height: 0,
      kind,
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: null,
    },
  }
}

function makeSingleGroup(
  id: string,
  kind: TerminalNodeData['kind'],
): WorkspaceArrangeSemanticGroup {
  const node = makeNode(id, kind)
  return {
    key: id,
    kind: 'single',
    rect: { x: 0, y: 0, width: 0, height: 0 },
    laneRank: 0,
    kindRank: 0,
    createdAt: null,
    area: 0,
    members: [{ node, kind }],
  }
}

describe('Workspace arrange semantic grid packing', () => {
  it('lets content fill beneath ideas instead of leaving a tall empty lane', () => {
    const groups: WorkspaceArrangeSemanticGroup[] = [
      makeSingleGroup('idea-1', 'note'),
      makeSingleGroup('terminal-1', 'terminal'),
      makeSingleGroup('terminal-2', 'terminal'),
      makeSingleGroup('terminal-3', 'terminal'),
    ]

    const result = resolveWorkspaceArrangeSemanticGridPlacements({
      groups,
      start: { x: 0, y: 0 },
      cell: { width: 108, height: 72 },
      gap: 12,
      targetAspect: 16 / 9,
      maxColumns: 10,
    })

    expect(result).not.toBeNull()
    if (!result) {
      return
    }

    expect(result.placements.get('idea-1')).toEqual({ x: 0, y: 0 })

    const terminalPlacements = ['terminal-1', 'terminal-2', 'terminal-3']
      .map(id => result.placements.get(id))
      .filter((placement): placement is NonNullable<typeof placement> => Boolean(placement))

    // Previously terminals were forced to start to the right of the idea lane, leaving a blank strip.
    expect(terminalPlacements.some(placement => placement.x === 0 && placement.y > 0)).toBe(true)
  })
})
