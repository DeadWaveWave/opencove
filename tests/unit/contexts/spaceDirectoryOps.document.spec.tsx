import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { useWorkspaceCanvasSpaceDirectoryOps } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDirectoryOps'

import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  agentNode,
  documentOf,
  renderInTwoWorkspaces,
  sized,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
  type RuntimeCanvasContext,
} from '../../support/agentRuntimeHarness'
import { replaceSpacesInStore } from '../../support/workspaceCanvasStoreHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'
import { setDocumentNodes } from '../../support/documentNodes'

// The directory change and the archive (#702, PR 14): each is one store write that plans from the
// document when it runs and flushes on itself. A Space that is not there writes and flushes
// nothing. The blocking-node list reads the store, in the workspace of the render.

const WORKTREE = '/repo/.opencove/worktrees/feat-a'
const workspaceOf = (id: string) =>
  useAppStore.getState().workspaces.find(workspace => workspace.id === id)

function spaceOf(id: string, nodeIds: string[], parentSpaceId: string | null = null) {
  return {
    id,
    name: id,
    directoryPath: '/repo',
    targetMountId: null,
    labelColor: null,
    nodeIds,
    rect: null,
    ...(parentSpaceId ? { parentSpaceId } : null),
  } as WorkspaceSpaceState
}

const terminal = (id: string): Node<TerminalNodeData> =>
  sized({
    ...pixelNode({ title: id, executionDirectory: '/repo', expectedDirectory: '/repo' }),
    id,
    type: 'terminalNode',
  })

const note = (id: string): Node<TerminalNodeData> =>
  sized({
    ...pixelNode({ kind: 'note', sessionId: '', title: id, note: { text: id } }),
    id,
    type: 'noteNode',
  })

function renderOps(documents: Parameters<typeof renderInTwoWorkspaces>[1] = {}) {
  const closeNode = vi.fn(async () => undefined)
  const rendered = renderInTwoWorkspaces(
    (context: RuntimeCanvasContext) =>
      useWorkspaceCanvasSpaceDirectoryOps({
        workspacePath: '/repo',
        updateCanvasDocument: context.writer.updateCanvasDocument,
        closeNode,
      }),
    documents,
  )
  rendered.harness.notifications.mockClear()
  return { ...rendered, ops: () => rendered.view.result.current, closeNode }
}

let layoutSyncs = 0
const countLayoutSync = () => {
  layoutSyncs += 1
}
function listenForLayoutSync() {
  layoutSyncs = 0
  window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, countLayoutSync)
}

afterEach(() => {
  window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, countLayoutSync)
})

describe('updateSpaceDirectory', () => {
  it('writes the Spaces and the directories of their nodes in one update, then flushes once', () => {
    const { harness, flushes, ops } = renderOps({
      a: { nodes: [terminal('t-1'), note('n-1')], spaces: [spaceOf('s-1', ['t-1', 'n-1'])] },
    })
    listenForLayoutSync()

    act(() => {
      ops().updateSpaceDirectory('s-1', WORKTREE, {
        markNodeDirectoryMismatch: true,
        renameSpaceTo: 'feat/a',
      })
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    const seen = flushes[0].document
    expect(seen.spaces[0]).toMatchObject({ name: 'feat/a', directoryPath: WORKTREE })
    expect(seen.nodes.find(node => node.id === 't-1')?.data).toMatchObject({
      executionDirectory: '/repo',
      expectedDirectory: WORKTREE,
    })
    expect(documentOf(A)).toEqual(seen)
    // The directory change leaves the layout alone.
    expect(layoutSyncs).toBe(0)
  })

  it('changes only the Spaces, in one update, when no node follows the directory', () => {
    const { harness, flushes, ops } = renderOps({
      a: { nodes: [terminal('t-1')], spaces: [spaceOf('s-1', ['t-1'])] },
    })
    const nodesBefore = documentOf(A).nodes

    act(() => {
      ops().updateSpaceDirectory('s-1', WORKTREE)
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(documentOf(A).spaces[0].directoryPath).toBe(WORKTREE)
    expect(documentOf(A).nodes).toBe(nodesBefore)
  })

  it('archives a Space and its nodes in one update, then flushes once', () => {
    const { harness, flushes, ops, closeNode } = renderOps({
      a: {
        nodes: [terminal('t-1'), note('n-1'), note('outside')],
        spaces: [spaceOf('s-1', ['t-1', 'n-1']), spaceOf('s-2', ['outside'])],
      },
    })
    listenForLayoutSync()

    act(() => {
      ops().updateSpaceDirectory('s-1', '/repo', { archiveSpace: true })
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes.map(node => node.id)).toEqual(['outside'])
    expect(flushes[0].document.spaces.map(space => space.id)).toEqual(['s-2'])
    expect(closeNode).not.toHaveBeenCalled()
    // Removing windows reshapes the layout.
    expect(layoutSyncs).toBe(1)
  })

  it('archives the child Spaces of a Space with it', () => {
    const { flushes, ops } = renderOps({
      a: {
        nodes: [note('n-1'), note('n-2')],
        spaces: [spaceOf('parent', ['n-1']), spaceOf('child', ['n-2'], 'parent')],
      },
    })

    act(() => {
      ops().updateSpaceDirectory('parent', '/repo', { archiveSpace: true })
    })

    expect(flushes).toHaveLength(1)
    expect(documentOf(A).spaces).toEqual([])
    expect(documentOf(A).nodes).toEqual([])
  })

  it('writes and flushes nothing for a Space that is not there', () => {
    const { harness, flushes, ops } = renderOps({
      a: { nodes: [terminal('t-1')], spaces: [spaceOf('s-1', ['t-1'])] },
    })
    const before = documentOf(A)
    listenForLayoutSync()

    act(() => {
      ops().updateSpaceDirectory('gone', WORKTREE, { markNodeDirectoryMismatch: true })
      ops().updateSpaceDirectory('gone', '/repo', { archiveSpace: true })
    })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(flushes).toHaveLength(0)
    expect(documentOf(A)).toEqual(before)
    expect(layoutSyncs).toBe(0)
  })

  it('plans from a Space that a store write added in the same act', () => {
    const { flushes, ops } = renderOps({ a: { nodes: [terminal('t-1')], spaces: [] } })

    act(() => {
      replaceSpacesInStore(A, [spaceOf('late', ['t-1'])])
      ops().updateSpaceDirectory('late', WORKTREE, { markNodeDirectoryMismatch: true })
    })

    expect(flushes).toHaveLength(1)
    expect(documentOf(A).spaces[0].directoryPath).toBe(WORKTREE)
    expect(documentOf(A).nodes[0].data.expectedDirectory).toBe(WORKTREE)
  })

  it('archives the nodes that a store write added to the Space in the same act', () => {
    const { ops } = renderOps({ a: { nodes: [], spaces: [spaceOf('s-1', ['late-node'])] } })

    act(() => {
      setDocumentNodes(A, [note('late-node')])
      ops().updateSpaceDirectory('s-1', '/repo', { archiveSpace: true })
    })

    expect(documentOf(A).nodes).toEqual([])
    expect(documentOf(A).spaces).toEqual([])
  })

  it('writes workspace A from the render that showed A, after B is shown', () => {
    const { harness, showB, flushes, ops } = renderOps({
      a: { nodes: [terminal('t-1')], spaces: [spaceOf('s-1', ['t-1'])] },
    })
    const opsOfA = ops()
    showB()
    harness.notifications.mockClear()
    const workspaceBBefore = workspaceOf(B)

    act(() => {
      opsOfA.updateSpaceDirectory('s-1', WORKTREE, { markNodeDirectoryMismatch: true })
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(documentOf(A).spaces[0].directoryPath).toBe(WORKTREE)
    expect(documentOf(A).nodes[0].data.expectedDirectory).toBe(WORKTREE)
    expect(workspaceOf(B)).toBe(workspaceBBefore)
  })

  it('writes workspace B from the render that shows B, not the first one', () => {
    const { harness, showB, flushes, ops } = renderOps({
      a: { nodes: [terminal('t-1')], spaces: [spaceOf('s-1', ['t-1'])] },
      b: { nodes: [terminal('t-b')], spaces: [spaceOf('s-b', ['t-b'])] },
    })
    showB()
    harness.notifications.mockClear()
    const workspaceABefore = workspaceOf(A)

    act(() => {
      ops().updateSpaceDirectory('s-b', WORKTREE, { markNodeDirectoryMismatch: true })
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(documentOf(B).spaces[0].directoryPath).toBe(WORKTREE)
    expect(documentOf(B).nodes[0].data.expectedDirectory).toBe(WORKTREE)
    expect(workspaceOf(A)).toBe(workspaceABefore)
  })

  it('does not find the Space of A in a render of B', () => {
    const { harness, showB, flushes, ops } = renderOps({
      a: { nodes: [terminal('t-1')], spaces: [spaceOf('s-1', ['t-1'])] },
    })
    showB()
    harness.notifications.mockClear()

    act(() => {
      ops().updateSpaceDirectory('s-1', WORKTREE)
    })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(flushes).toHaveLength(0)
    expect(documentOf(A).spaces[0].directoryPath).toBe('/repo')
  })
})

describe('getSpaceBlockingNodes', () => {
  it('lists the agents and terminals the store holds, also one added in the same act', () => {
    const { ops } = renderOps({
      a: {
        nodes: [terminal('t-1'), note('n-1')],
        spaces: [spaceOf('s-1', ['t-1', 'n-1', 'a-late'])],
      },
    })

    let blocking: ReturnType<ReturnType<typeof ops>['getSpaceBlockingNodes']> | null = null
    act(() => {
      setDocumentNodes(A, [...documentOf(A).nodes, agentNode('a-late')])
      blocking = ops().getSpaceBlockingNodes('s-1')
    })

    expect(blocking).toEqual({ agentNodeIds: ['a-late'], terminalNodeIds: ['t-1'] })
  })

  it('reads the Spaces of the store, also one added in the same act', () => {
    const { ops } = renderOps({ a: { nodes: [terminal('t-1')], spaces: [] } })

    let blocking: ReturnType<ReturnType<typeof ops>['getSpaceBlockingNodes']> | null = null
    act(() => {
      replaceSpacesInStore(A, [spaceOf('late', ['t-1'])])
      blocking = ops().getSpaceBlockingNodes('late')
    })

    expect(blocking).toEqual({ agentNodeIds: [], terminalNodeIds: ['t-1'] })
  })

  it('answers for A from the render that showed A, after B is shown', () => {
    const { showB, ops } = renderOps({
      a: { nodes: [terminal('t-1')], spaces: [spaceOf('s-1', ['t-1'])] },
    })
    const opsOfA = ops()
    showB()

    expect(opsOfA.getSpaceBlockingNodes('s-1')).toEqual({
      agentNodeIds: [],
      terminalNodeIds: ['t-1'],
    })
  })

  it('answers for B in a render of B, with A holding a Space of the same id', () => {
    const { showB, ops } = renderOps({
      a: { nodes: [terminal('t-1')], spaces: [spaceOf('s-1', ['t-1'])] },
    })
    act(() => {
      setDocumentNodes(B, [agentNode('b-agent')])
      replaceSpacesInStore(B, [spaceOf('s-1', ['b-agent'])])
    })
    showB()

    expect(ops().getSpaceBlockingNodes('s-1')).toEqual({
      agentNodeIds: ['b-agent'],
      terminalNodeIds: [],
    })
  })
})
