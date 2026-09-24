import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../types'
import {
  EMPTY_CANVAS_COLLAPSE,
  normalizeCanvasCollapse,
  canvasCollapseFromPersistedLists,
  normalizeCollapsedIdList,
  projectCollapsedNodes,
  revealCollapsedNode,
  collectSpaceNodeIds,
  serializeCanvasCollapse,
  type CanvasCollapseState,
} from './canvasCollapse'
import { planCollapsedArrangement, restoreCollapsedArrangement } from './canvasCollapseArrange'

const node = (id: string, kind: TerminalNodeData['kind'] = 'terminal'): Node<TerminalNodeData> => ({
  id,
  position: { x: 100, y: 120 },
  type: 'terminalNode',
  data: {
    sessionId: `session-${id}`,
    title: id,
    kind,
    width: 640,
    height: 480,
    status: 'running',
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: 'preserved',
    agent: null,
    task: null,
    note: null,
    image: null,
    document: null,
    website: null,
  },
})
const spaces: WorkspaceSpaceState[] = [
  {
    id: 'root',
    name: 'Root',
    nodeIds: ['a'],
    directoryPath: '/tmp',
    targetMountId: null,
    labelColor: null,
    rect: { x: 0, y: 0, width: 900, height: 1000 },
  },
  {
    id: 'child',
    parentSpaceId: 'root',
    name: 'Child',
    nodeIds: ['b'],
    directoryPath: '/tmp',
    targetMountId: null,
    labelColor: null,
    rect: { x: 20, y: 50, width: 800, height: 600 },
  },
]

describe('canvas collapse presentation boundary', () => {
  it('repairs missing and invalid stored preferences without changing runtime defaults', () => {
    expect(normalizeCanvasCollapse(null)).toEqual(EMPTY_CANVAS_COLLAPSE)
    expect(
      normalizeCanvasCollapse({
        collapsedNodeIds: { a: true, b: false, c: 'true', '': true },
        collapsedSpaceIds: [],
      }),
    ).toEqual({ collapsedNodeIds: { a: true }, collapsedSpaceIds: {} })
  })
  it('round-trips compact IDs through the durable workspace envelope', () => {
    const state: CanvasCollapseState = {
      collapsedNodeIds: { agent: true, terminal: true },
      collapsedSpaceIds: { legacySpace: true },
    }
    const persisted = serializeCanvasCollapse(state)
    expect(persisted).toEqual({
      collapsedNodeIds: ['agent', 'terminal'],
      collapsedSpaceIds: ['legacySpace'],
    })
    expect(
      canvasCollapseFromPersistedLists(persisted.collapsedNodeIds, persisted.collapsedSpaceIds),
    ).toEqual(state)
    expect(normalizeCollapsedIdList([' agent ', 'agent', '', 4, null])).toEqual(['agent'])
    expect(canvasCollapseFromPersistedLists([], [])).toBeNull()
  })
  it('keeps every runtime mounted and leaves canonical dimensions and session identity intact', () => {
    const nodes = [node('a'), node('b', 'agent'), node('c', 'document')]
    const result = projectCollapsedNodes(nodes, spaces, {
      collapsedNodeIds: { c: true },
      collapsedSpaceIds: { root: true },
    })
    expect(result).toHaveLength(nodes.length)
    result.forEach((value, index) => {
      expect(value.hidden).not.toBe(true)
      expect(value.data.width).toBe(nodes[index].data.width)
      expect(value.data.height).toBe(nodes[index].data.height)
      expect(value.data.sessionId).toBe(nodes[index].data.sessionId)
    })
    expect(result[0].style).toMatchObject({ width: 0, height: 0, visibility: 'hidden' })
    expect(result[1].data.collapsePresentation?.spaceHidden).toBe(true)
    expect(result[2].style).toMatchObject({ width: 112, height: 96 })
    expect(nodes[0].data.collapsePresentation).toBeUndefined()
  })
  it('reveals only the target and its ancestor path, retaining other collapsed windows', () => {
    const result = revealCollapsedNode(
      {
        collapsedNodeIds: { a: true, b: true },
        collapsedSpaceIds: { root: true, child: true, unrelated: true },
      },
      'b',
      spaces,
    )
    expect(result).toEqual({
      collapsedNodeIds: { a: true },
      collapsedSpaceIds: { unrelated: true },
    })
    expect([...collectSpaceNodeIds('root', spaces)]).toEqual(['a', 'b'])
  })
  it('keeps Agent and terminal icon geometry equal without changing their runtime dimensions', () => {
    const terminal = node('terminal')
    const overlay = {
      ...node('overlay'),
      data: {
        ...node('overlay').data,
        agentOverlay: { provider: 'codex' as const, status: 'running' as const, startedAtMs: 1 },
      },
    }
    const nodes = [terminal, node('agent', 'agent'), overlay]
    const projected = projectCollapsedNodes(nodes, [], {
      collapsedNodeIds: { terminal: true, agent: true, overlay: true },
      collapsedSpaceIds: {},
    })
    projected.forEach(item => {
      expect(item).toMatchObject({ width: 112, height: 96, initialWidth: 112, initialHeight: 96 })
      expect(item.data).toMatchObject({ width: 640, height: 480, sessionId: `session-${item.id}` })
    })
  })
  it('tidies presentation cards and restores layout without overwriting later content or resurrecting nodes', () => {
    const nodes = [node('a'), node('b', 'agent')]
    const plan = planCollapsedArrangement('root', nodes, spaces, {
      collapsedNodeIds: { b: true },
      collapsedSpaceIds: { root: true },
    })!
    expect(plan.state.collapsedSpaceIds.root).toBeUndefined()
    expect(plan.state.collapsedNodeIds).toEqual({ a: true, b: true })
    expect(plan.nodes[0].data).toBe(nodes[0].data)
    const movedSpaces = spaces.map(space => ({
      ...space,
      rect: { ...space.rect!, x: space.rect!.x + 50 },
    }))
    const editedNodes = [
      { ...plan.nodes[0], data: { ...plan.nodes[0].data, title: 'edited later' } },
      node('new'),
    ]
    const restored = restoreCollapsedArrangement(
      plan.snapshot,
      editedNodes,
      movedSpaces,
      plan.state,
    )
    expect(restored.nodes.map(item => item.id)).toEqual(['a', 'new'])
    expect(restored.nodes[0].data.title).toBe('edited later')
    expect(restored.nodes).toBe(editedNodes)
    expect(restored.spaces).toBe(movedSpaces)
    expect(restored.state.collapsedNodeIds.a).toBe(true)
  })
})
