import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { renderSpaceOwnership } from '../../support/spaceOwnershipHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

const node: Node<TerminalNodeData> = { ...pixelNode({ kind: 'note', sessionId: '' }), id: 'n1' }
// Shift keeps the node selection, so the drag start does not clear the selected Spaces.
const event = { clientX: 10, clientY: 10, shiftKey: true } as React.MouseEvent

function setup(spaceIds: string[]) {
  const harness = renderSpaceOwnership({ nodes: [node], selectedNodeIds: ['n1'] })
  act(() => harness.result.current.selection.setSpaceIds(spaceIds))
  const { ownership, nodeDragSession } = harness.result.current
  return { ownership, session: nodeDragSession }
}

// Decision 7 of #692: the node drag copies the selected Spaces at the start and drops the copy at
// the end of the stop handler, also when it leaves early because the copy is not empty.
describe('space ownership drag copy', () => {
  it.each(['node drag', 'selection drag'])('%s start copies the selected Spaces', kind => {
    const { ownership, session } = setup(['b', 'a'])

    act(() =>
      kind === 'node drag'
        ? ownership.handleNodeDragStart(event, node, [node])
        : ownership.handleSelectionDragStart(event, [node]),
    )

    expect(session.getDragStartSpaceSelection()).toEqual(['a', 'b'])
  })

  it.each(['node drag', 'selection drag'])(
    '%s stop with Spaces selected leaves early and drops the copy',
    kind => {
      const { ownership, session } = setup(['a'])
      act(() =>
        kind === 'node drag'
          ? ownership.handleNodeDragStart(event, node, [node])
          : ownership.handleSelectionDragStart(event, [node]),
      )

      act(() =>
        kind === 'node drag'
          ? ownership.handleNodeDragStop(event, node, [node])
          : ownership.handleSelectionDragStop(event, [node]),
      )

      expect(session.getDragStartSpaceSelection()).toBeNull()
    },
  )

  it.each(['node drag', 'selection drag'])(
    '%s stop without Spaces runs to its end and drops the copy',
    kind => {
      const { ownership, session } = setup([])
      act(() =>
        kind === 'node drag'
          ? ownership.handleNodeDragStart(event, node, [node])
          : ownership.handleSelectionDragStart(event, [node]),
      )
      expect(session.getDragStartSpaceSelection()).toEqual([])

      act(() =>
        kind === 'node drag'
          ? ownership.handleNodeDragStop(event, node, [node])
          : ownership.handleSelectionDragStop(event, [node]),
      )

      expect(session.getDragStartSpaceSelection()).toBeNull()
    },
  )
})
