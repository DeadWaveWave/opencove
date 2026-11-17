import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  applySpaceFramePreview,
  resolveGrabbedNodeId,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges.helpers'
import { removeNodesAndUnlink } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'

describe('applySpaceFramePreview', () => {
  const spaces = [
    createSpace('s1', { x: 0, y: 0, width: 100, height: 100 }),
    createSpace('s2', { x: 200, y: 0, width: 100, height: 100 }),
  ]

  it('returns the same array when no rect changes', () => {
    const preview = new Map([['s1', { x: 0, y: 0, width: 100, height: 100 }]])

    expect(applySpaceFramePreview(spaces, preview)).toBe(spaces)
    expect(applySpaceFramePreview(spaces, new Map())).toBe(spaces)
  })

  it('replaces the rects the preview moves and keeps the other Spaces themselves', () => {
    const next = applySpaceFramePreview(
      spaces,
      new Map([['s1', { x: 5, y: 6, width: 100, height: 100 }]]),
    )

    expect(next).not.toBe(spaces)
    expect(next[0].rect).toEqual({ x: 5, y: 6, width: 100, height: 100 })
    expect(next[1]).toBe(spaces[1])
  })

  it('ignores a preview of a Space the document no longer holds', () => {
    const preview = new Map([['gone', { x: 5, y: 6, width: 1, height: 1 }]])

    expect(applySpaceFramePreview(spaces, preview)).toBe(spaces)
  })
})

describe('removeNodesAndUnlink', () => {
  const [task, agent, other] = createRowNodes(['task', 'agent', 'other'])
  const linkedTask = {
    ...task,
    data: {
      ...task.data,
      kind: 'task',
      task: { status: 'doing', linkedAgentNodeId: 'agent', updatedAt: 'before' },
    },
  } as unknown as Node<TerminalNodeData>
  const linkedAgent = {
    ...agent,
    data: { ...agent.data, kind: 'agent', agent: { taskId: 'task' } },
  } as unknown as Node<TerminalNodeData>

  it('returns the same array when nothing is removed', () => {
    const nodes = [linkedTask, other]

    expect(removeNodesAndUnlink(nodes, new Set())).toBe(nodes)
  })

  it('returns the same array when the removed windows are not in it and nothing links to them', () => {
    const nodes = [linkedTask, other]

    expect(removeNodesAndUnlink(nodes, new Set(['gone']))).toBe(nodes)
  })

  it('takes the removed windows out and keeps the others themselves', () => {
    const nodes = [linkedTask, other]

    const next = removeNodesAndUnlink(nodes, new Set(['other']))

    expect(next).toEqual([linkedTask])
    expect(next[0]).toBe(linkedTask)
  })

  it('unlinks a task from the agent that is removed, and puts a doing task back to todo', () => {
    const [unlinked] = removeNodesAndUnlink([linkedTask, linkedAgent], new Set(['agent']))

    expect(unlinked.data.task?.linkedAgentNodeId).toBeNull()
    expect(unlinked.data.task?.status).toBe('todo')
    expect(unlinked.data.task?.updatedAt).not.toBe('before')
  })

  it('unlinks an agent from the task that is removed', () => {
    const [unlinked] = removeNodesAndUnlink([linkedAgent, linkedTask], new Set(['task']))

    expect(unlinked.data.agent?.taskId).toBeNull()
  })
})

describe('resolveGrabbedNodeId', () => {
  const entry = (dragging?: boolean) => ({ position: { x: 0, y: 0 }, dragging })

  it('is the window the pointer anchor names, while the overlay holds it as dragging', () => {
    const live = new Map([
      ['a', entry(true)],
      ['b', entry(true)],
    ])

    expect(resolveGrabbedNodeId({ nodeId: 'b' }, live)).toBe('b')
  })

  // An anchor outlives its drag when the drag ended without a release. Next to the overlay of
  // another drag it names no window that drag moves.
  it('ignores an anchor for a window the overlay does not drag', () => {
    const live = new Map([
      ['a', entry(true)],
      ['b', entry(false)],
    ])

    expect(resolveGrabbedNodeId({ nodeId: 'gone' }, live)).toBe('a')
    expect(resolveGrabbedNodeId({ nodeId: 'b' }, live)).toBe('a')
    expect(resolveGrabbedNodeId({ nodeId: 'gone' }, null)).toBeNull()
  })

  it('is the one dragged window when there is no anchor', () => {
    const live = new Map([
      ['a', entry(true)],
      ['p', entry(false)],
      ['q', entry()],
    ])

    expect(resolveGrabbedNodeId(null, live)).toBe('a')
  })

  it('cannot tell without an anchor when none or several windows are dragged', () => {
    expect(resolveGrabbedNodeId(null, null)).toBeNull()
    expect(resolveGrabbedNodeId(null, new Map())).toBeNull()
    expect(resolveGrabbedNodeId(null, new Map([['a', entry(false)]]))).toBeNull()
    expect(
      resolveGrabbedNodeId(
        null,
        new Map([
          ['a', entry(true)],
          ['b', entry(true)],
        ]),
      ),
    ).toBeNull()
  })

  it('cannot tell which of several dragged windows the anchor of a stale drag meant', () => {
    const live = new Map([
      ['a', entry(true)],
      ['b', entry(true)],
    ])

    expect(resolveGrabbedNodeId({ nodeId: 'gone' }, live)).toBeNull()
  })
})
