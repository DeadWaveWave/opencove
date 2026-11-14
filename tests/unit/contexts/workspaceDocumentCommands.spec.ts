import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  appendWorkspaceSpaceArchiveRecord,
  bindWorkspaceDocumentStore,
  commitCanvasDocument,
  isActiveWorkspace,
  registerWorkspaceDocumentPersistFlush,
  removeWorkspaceSpaceArchiveRecord,
  replaceWorkspaceNodes,
  replaceWorkspaceSpaces,
  setWorkspaceActiveSpace,
  setWorkspaceMinimapVisible,
  setWorkspaceViewport,
  type WorkspaceDocumentStoreState,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type {
  SpaceArchiveRecord,
  WorkspaceSpaceState,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'

function space(id: string, nodeIds: string[]): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/tmp/workspace',
    targetMountId: null,
    labelColor: null,
    nodeIds,
    rect: { x: 0, y: 0, width: 400, height: 300 },
  } as WorkspaceSpaceState
}

function workspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: `/tmp/${id}`,
    nodes: [pixelNode({ title: id })],
    spaces: [space(`${id}-space`, ['terminal-1'])],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

function archiveRecord(id: string): SpaceArchiveRecord {
  return { id } as unknown as SpaceArchiveRecord
}

describe('workspace document commands', () => {
  let flush: ReturnType<typeof vi.fn>
  let unregister: () => void

  beforeEach(() => {
    useAppStore.setState({
      workspaces: [workspace('a'), workspace('b')],
      activeWorkspaceId: 'a',
    })
    flush = vi.fn()
    unregister = registerWorkspaceDocumentPersistFlush(flush)
  })

  afterEach(() => {
    unregister()
    bindWorkspaceDocumentStore(useAppStore)
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('notifies once for a nodes and Spaces change and not at all for a no-op', () => {
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    const applied = commitCanvasDocument('a', document => ({
      ...document,
      nodes: [],
      spaces: [space('a-space', [])],
    }))
    expect(applied.status).toBe('applied')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().workspaces[0].nodes).toEqual([])

    listener.mockClear()
    expect(commitCanvasDocument('a', document => document).status).toBe('unchanged')
    expect(replaceWorkspaceNodes('a', useAppStore.getState().workspaces[0].nodes).status).toBe(
      'unchanged',
    )
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('returns missing for an unknown workspace without writing or flushing', () => {
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)
    const before = useAppStore.getState().workspaces

    const result = commitCanvasDocument('gone', document => ({ ...document, nodes: [] }), {
      flush: true,
    })

    expect(result).toEqual({ status: 'missing' })
    expect(useAppStore.getState().workspaces).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('changes only the named workspace, whichever workspace is active', () => {
    const [, workspaceB] = useAppStore.getState().workspaces
    useAppStore.setState({ activeWorkspaceId: 'b' })

    replaceWorkspaceNodes('a', [])

    const [workspaceA, nextB] = useAppStore.getState().workspaces
    expect(workspaceA.nodes).toEqual([])
    expect(nextB).toBe(workspaceB)
    expect(isActiveWorkspace('a')).toBe(false)
    expect(isActiveWorkspace('b')).toBe(true)
  })

  it('flushes after the write and only when requested', () => {
    const order: string[] = []
    flush.mockImplementation(() => {
      order.push(`flush:${useAppStore.getState().workspaces[0].isMinimapVisible}`)
    })

    setWorkspaceMinimapVisible('a', false)
    expect(flush).not.toHaveBeenCalled()

    commitCanvasDocument('a', document => ({ ...document, isMinimapVisible: true }), {
      flush: true,
    })
    expect(order).toEqual(['flush:true'])
  })

  it('flushes on an unchanged result when requested, without writing', () => {
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    removeWorkspaceSpaceArchiveRecord('a', 'missing-record')

    expect(flush).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('throws when a command runs inside a recipe and clears the guard afterwards', () => {
    expect(() =>
      commitCanvasDocument('a', document => {
        replaceWorkspaceNodes('b', [])
        return document
      }),
    ).toThrow('workspace document command ran inside a recipe')

    expect(replaceWorkspaceNodes('a', []).status).toBe('applied')
  })

  it('clears the guard when a recipe throws', () => {
    expect(() =>
      commitCanvasDocument('a', () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')

    expect(replaceWorkspaceNodes('a', []).status).toBe('applied')
  })

  it('writes to the store it was last bound to', () => {
    const state: WorkspaceDocumentStoreState = {
      workspaces: [workspace('solo')],
      activeWorkspaceId: 'solo',
    }
    const fresh = createStore<WorkspaceDocumentStoreState>(() => state)
    bindWorkspaceDocumentStore(fresh)

    replaceWorkspaceNodes('solo', [])

    expect(fresh.getState().workspaces[0].nodes).toEqual([])
    expect(useAppStore.getState().workspaces[0].nodes).not.toEqual([])
  })

  it('throws when no store was ever bound', async () => {
    vi.resetModules()
    const unbound =
      await import('../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands')

    expect(() => unbound.replaceWorkspaceNodes('a', [])).toThrow(
      'workspace document store is not bound',
    )
  })

  it('stops flushing once the registration is cleared, and keeps a newer registration', () => {
    const newer = vi.fn()
    const unregisterNewer = registerWorkspaceDocumentPersistFlush(newer)
    unregister()

    appendWorkspaceSpaceArchiveRecord('a', archiveRecord('r1'))
    expect(newer).toHaveBeenCalledTimes(1)
    expect(flush).not.toHaveBeenCalled()

    unregisterNewer()
    appendWorkspaceSpaceArchiveRecord('a', archiveRecord('r2'))
    expect(newer).toHaveBeenCalledTimes(1)
  })

  it('implements the named commands with the handler semantics they replace', () => {
    setWorkspaceViewport('a', { x: 5, y: 6, zoom: 2 })
    expect(useAppStore.getState().workspaces[0].viewport).toEqual({ x: 5, y: 6, zoom: 2 })
    const viewportWorkspace = useAppStore.getState().workspaces[0]
    expect(setWorkspaceViewport('a', { x: 5, y: 6, zoom: 2 }).status).toBe('unchanged')
    expect(useAppStore.getState().workspaces[0]).toBe(viewportWorkspace)

    setWorkspaceActiveSpace('a', 'a-space')
    expect(useAppStore.getState().workspaces[0].activeSpaceId).toBe('a-space')
    setWorkspaceActiveSpace('a', 'no-such-space')
    expect(useAppStore.getState().workspaces[0].activeSpaceId).toBeNull()

    setWorkspaceActiveSpace('a', 'a-space')
    replaceWorkspaceSpaces('a', [space('other', ['terminal-1', 'terminal-1'])])
    const afterSpaces = useAppStore.getState().workspaces[0]
    expect(afterSpaces.spaces[0].nodeIds).toEqual(['terminal-1'])
    expect(afterSpaces.activeSpaceId).toBeNull()

    appendWorkspaceSpaceArchiveRecord('a', archiveRecord('r1'))
    expect(useAppStore.getState().workspaces[0].spaceArchiveRecords.map(r => r.id)).toEqual(['r1'])
    removeWorkspaceSpaceArchiveRecord('a', 'r1')
    expect(useAppStore.getState().workspaces[0].spaceArchiveRecords).toEqual([])
  })

  it('keeps the shell store bound to the module', () => {
    const before = useAppStore.getState().workspaces
    replaceWorkspaceNodes('b', [])
    expect(useAppStore.getState().workspaces).not.toBe(before)
    expect(useAppStore.getState().workspaces[0]).toBe(before[0])
  })
})
