import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  bindWorkspaceDocumentStore,
  hydrateWorkspaceList,
  mergeHydratedNodes,
  replaceWorkspaceNodes,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type {
  WorkspaceSpaceState,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'

function workspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: `/tmp/${id}`,
    nodes: [pixelNode({ title: id })],
    spaces: [
      {
        id: `${id}-space`,
        name: id,
        directoryPath: '/tmp/workspace',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['terminal-1'],
        rect: { x: 0, y: 0, width: 400, height: 300 },
      } as WorkspaceSpaceState,
    ],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

describe('workspace document hydration entries', () => {
  beforeEach(() => {
    useAppStore.setState({ workspaces: [workspace('a'), workspace('b')], activeWorkspaceId: 'a' })
  })

  afterEach(() => {
    bindWorkspaceDocumentStore(useAppStore)
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('installs the list, then the active workspace, as two writes in that order', () => {
    const initial = [workspace('x'), workspace('y')]
    const seen: Array<{ list: WorkspaceState[]; active: string | null }> = []
    const unsubscribe = useAppStore.subscribe(state => {
      seen.push({ list: state.workspaces, active: state.activeWorkspaceId })
    })

    hydrateWorkspaceList({ workspaces: initial, activeWorkspaceId: 'y' })
    unsubscribe()

    expect(seen).toHaveLength(2)
    expect(seen[0].list).toBe(initial)
    expect(seen[0].active).toBe('a')
    expect(seen[1].list).toBe(initial)
    expect(seen[1].active).toBe('y')
  })

  it('keeps a list that a listener wrote during the first notification', () => {
    const initial = [workspace('x'), workspace('y')]
    const written = [workspace('x'), workspace('y')]
    let wrote = false
    const unsubscribe = useAppStore.subscribe(state => {
      if (!wrote && state.workspaces === initial) {
        wrote = true
        useAppStore.setState({ workspaces: written })
      }
    })

    hydrateWorkspaceList({ workspaces: initial, activeWorkspaceId: 'y' })
    unsubscribe()

    expect(wrote).toBe(true)
    expect(useAppStore.getState().workspaces).toBe(written)
    expect(useAppStore.getState().activeWorkspaceId).toBe('y')
  })

  it('merges nodes of the named workspace only and keeps its Spaces and the other workspace', () => {
    const before = useAppStore.getState().workspaces
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    const result = mergeHydratedNodes('b', nodes =>
      nodes.map(node => ({ ...node, data: { ...node.data, title: 'merged' } })),
    )
    unsubscribe()

    expect(result.status).toBe('applied')
    expect(listener).toHaveBeenCalledTimes(1)
    const after = useAppStore.getState().workspaces
    expect(after[1].nodes[0].data.title).toBe('merged')
    expect(after[1].spaces).toBe(before[1].spaces)
    expect(after[0]).toBe(before[0])
  })

  it('keeps Spaces as they are when a node object is replaced', () => {
    const before = useAppStore.getState().workspaces[0]

    mergeHydratedNodes('a', nodes => nodes.map(node => ({ ...node })))

    const after = useAppStore.getState().workspaces[0]
    expect(after.nodes[0]).not.toBe(before.nodes[0])
    expect(after.spaces).toBe(before.spaces)
  })

  it('throws instead of leaving Spaces dangling when a merge removes or adds a node', () => {
    const before = useAppStore.getState().workspaces
    const message = 'hydration merges may only change existing nodes'

    expect(() => mergeHydratedNodes('a', () => [])).toThrow(message)
    expect(() =>
      mergeHydratedNodes('a', nodes => [...nodes, { ...pixelNode(), id: 'terminal-2' }]),
    ).toThrow(message)
    expect(useAppStore.getState().workspaces).toBe(before)
  })

  it('writes nothing when the recipe returns the same nodes, or the workspace is missing', () => {
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    expect(mergeHydratedNodes('a', nodes => nodes).status).toBe('unchanged')
    expect(mergeHydratedNodes('missing', nodes => nodes)).toEqual({ status: 'missing' })
    unsubscribe()

    expect(listener).not.toHaveBeenCalled()
  })

  it('computes from the store at call time, not from an earlier snapshot', () => {
    replaceWorkspaceNodes('a', [pixelNode({ title: 'user edit' })])

    mergeHydratedNodes('a', nodes =>
      nodes.map(node => ({ ...node, data: { ...node.data, scrollback: 'restored' } })),
    )

    const node = useAppStore.getState().workspaces[0].nodes[0]
    expect(node.data.title).toBe('user edit')
    expect(node.data.scrollback).toBe('restored')
  })

  it('refuses to run inside a recipe', () => {
    expect(() =>
      mergeHydratedNodes('a', nodes => {
        hydrateWorkspaceList({ workspaces: [], activeWorkspaceId: null })
        return nodes
      }),
    ).toThrow('workspace document command ran inside a recipe')
  })
})
