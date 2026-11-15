import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
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

describe('space ownership drag start on an unselected node', () => {
  it('clears the selected Spaces, and a shift drag start keeps them', () => {
    const harness = renderSpaceOwnership({ nodes: [node], selectedNodeIds: [] })
    act(() => harness.result.current.selection.setSpaceIds(['a']))
    const { ownership } = harness.result.current
    const spaceIds = () => harness.result.current.readSelection().spaceIds

    act(() =>
      ownership.handleNodeDragStart({ ...event, shiftKey: true } as React.MouseEvent, node, [node]),
    )
    expect(spaceIds()).toEqual(['a'])

    act(() =>
      ownership.handleNodeDragStart({ ...event, shiftKey: false } as React.MouseEvent, node, [
        node,
      ]),
    )

    expect(spaceIds()).toEqual([])
  })
})

// Decision 6 of #692: the drag start reads `node.selected`, the flag React Flow hands it, and
// writes the node and Space selection with one command. The store is not its source.
describe('space ownership drag start writes the node selection', () => {
  const plain = { clientX: 10, clientY: 10, shiftKey: false } as React.MouseEvent

  function start(
    harness: ReturnType<typeof renderSpaceOwnership>,
    flagged: Node<TerminalNodeData>,
    shift = false,
  ) {
    act(() =>
      harness.result.current.ownership.handleNodeDragStart(
        { ...plain, shiftKey: shift } as React.MouseEvent,
        flagged,
        [flagged],
      ),
    )
  }

  it('selects only the dragged node and clears the Spaces when its flag is not set', () => {
    const harness = renderSpaceOwnership({ nodes: [node], selectedNodeIds: ['other'] })
    act(() => harness.result.current.selection.setSpaceIds(['a']))

    start(harness, { ...node, selected: undefined })

    expect(harness.result.current.readSelection()).toMatchObject({ nodeIds: ['n1'], spaceIds: [] })
  })

  it('keeps mirroring the selected flag onto the document nodes of a replaced selection', () => {
    const harness = renderSpaceOwnership({ nodes: [node], selectedNodeIds: ['other'] })
    const other: Node<TerminalNodeData> = { ...node, id: 'other', selected: true }

    start(harness, { ...node, selected: false })

    expect(harness.setNodes).toHaveBeenCalledTimes(1)
    const recipe = harness.setNodes.mock.calls[0][0] as (
      previous: Node<TerminalNodeData>[],
    ) => Node<TerminalNodeData>[]
    const next = recipe([{ ...node, selected: false }, other])
    expect(next.filter(item => item.selected).map(item => item.id)).toEqual(['n1'])
  })

  it('replaces the selection when the flag is not set although the store already names the node', () => {
    const harness = renderSpaceOwnership({ nodes: [node], selectedNodeIds: ['n1'] })
    act(() => harness.result.current.selection.setSpaceIds(['a']))

    start(harness, { ...node, selected: false })

    expect(harness.result.current.readSelection()).toMatchObject({ nodeIds: ['n1'], spaceIds: [] })
  })

  it('keeps the selection when the flag is set although the store does not name the node', () => {
    const harness = renderSpaceOwnership({ nodes: [node], selectedNodeIds: ['other'] })
    act(() => harness.result.current.selection.setSpaceIds(['a']))
    const before = harness.result.current.readSelection()

    start(harness, { ...node, selected: true })

    expect(harness.result.current.readSelection()).toBe(before)
  })

  it('keeps the node and Space selection of a shift drag start', () => {
    const harness = renderSpaceOwnership({ nodes: [node], selectedNodeIds: ['other'] })
    act(() => harness.result.current.selection.setSpaceIds(['a']))
    const before = harness.result.current.readSelection()

    start(harness, { ...node, selected: false }, true)

    expect(harness.result.current.readSelection()).toBe(before)
  })

  it('writes the node and the Space selection with one select command', () => {
    const harness = renderSpaceOwnership({ nodes: [node], selectedNodeIds: ['other'] })
    act(() => harness.result.current.selection.setSpaceIds(['a']))
    const { selection } = harness.result.current
    const select = vi.spyOn(selection, 'select')
    const others = [
      vi.spyOn(selection, 'setNodeIds'),
      vi.spyOn(selection, 'setSpaceIds'),
      vi.spyOn(selection, 'clear'),
    ]

    start(harness, { ...node, selected: false })

    expect(select).toHaveBeenCalledExactlyOnceWith({ nodeIds: ['n1'], spaceIds: [] })
    others.forEach(spy => expect(spy).not.toHaveBeenCalled())
  })
})
