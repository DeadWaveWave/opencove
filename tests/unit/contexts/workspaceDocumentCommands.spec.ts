import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  appendWorkspaceSpaceArchiveRecord,
  applyRuntimeObservation,
  bindWorkspaceDocumentStore,
  commitCanvasDocument,
  mergeHydratedNodes,
  replaceFromSync,
  isActiveWorkspace,
  readWorkspaceDocument,
  registerWorkspaceDocumentPersistFlush,
  requestWorkspaceDocumentPersistFlush,
  removeWorkspaceSpaceArchiveRecord,
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
import { setDocumentNodes } from '../../support/documentNodes'

const CANVAS_ONLY_FIELDS = ['selected', 'dragHandle', 'dragging'] as const

function withCanvasOnlyField(
  node: WorkspaceState['nodes'][number],
  field: (typeof CANVAS_ONLY_FIELDS)[number],
): WorkspaceState['nodes'][number] {
  return { ...node, [field]: field === 'dragHandle' ? '.drag-handle' : false }
}

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
    expect(setDocumentNodes('a', useAppStore.getState().workspaces[0].nodes).status).toBe(
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

    setDocumentNodes('a', [])

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

  // A flush persists the write it accompanies (S7): a result that wrote nothing has nothing to
  // persist, whichever status says so.
  it('an unchanged result requests no flush and writes nothing', () => {
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    expect(removeWorkspaceSpaceArchiveRecord('a', 'missing-record').status).toBe('unchanged')
    expect(commitCanvasDocument('a', document => document, { flush: true }).status).toBe(
      'unchanged',
    )

    expect(flush).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('throws when a command runs inside a recipe and clears the guard afterwards', () => {
    expect(() =>
      commitCanvasDocument('a', document => {
        setDocumentNodes('b', [])
        return document
      }),
    ).toThrow('workspace document command ran inside a recipe')

    expect(setDocumentNodes('a', []).status).toBe('applied')
  })

  it('clears the guard when a recipe throws', () => {
    expect(() =>
      commitCanvasDocument('a', () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')

    expect(setDocumentNodes('a', []).status).toBe('applied')
  })

  it('writes to the store it was last bound to', () => {
    const state: WorkspaceDocumentStoreState = {
      workspaces: [workspace('solo')],
      activeWorkspaceId: 'solo',
    }
    const fresh = createStore<WorkspaceDocumentStoreState>(() => state)
    bindWorkspaceDocumentStore(fresh)

    setDocumentNodes('solo', [])

    expect(fresh.getState().workspaces[0].nodes).toEqual([])
    expect(useAppStore.getState().workspaces[0].nodes).not.toEqual([])
  })

  it('throws when no store was ever bound', async () => {
    vi.resetModules()
    const unbound =
      await import('../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands')

    expect(() => unbound.commitCanvasDocument('a', document => document)).toThrow(
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
    commitCanvasDocument('a', document => ({
      ...document,
      spaces: [space('other', ['terminal-1', 'terminal-1'])],
    }))
    const afterSpaces = useAppStore.getState().workspaces[0]
    expect(afterSpaces.spaces[0].nodeIds).toEqual(['terminal-1'])
    expect(afterSpaces.activeSpaceId).toBeNull()

    appendWorkspaceSpaceArchiveRecord('a', archiveRecord('r1'))
    expect(useAppStore.getState().workspaces[0].spaceArchiveRecords.map(r => r.id)).toEqual(['r1'])
    removeWorkspaceSpaceArchiveRecord('a', 'r1')
    expect(useAppStore.getState().workspaces[0].spaceArchiveRecords).toEqual([])
  })

  it('reads the committed document of a workspace as the store holds it now', () => {
    const [workspaceA] = useAppStore.getState().workspaces

    const document = readWorkspaceDocument('a')

    expect(document).not.toBeNull()
    expect(document?.nodes).toBe(workspaceA.nodes)
    expect(document?.spaces).toBe(workspaceA.spaces)

    commitCanvasDocument('a', current => ({ ...current, spaces: [space('later', [])] }))
    expect(readWorkspaceDocument('a')?.spaces.map(item => item.id)).toEqual(['later'])
    // A document read earlier is a snapshot: it does not follow the store.
    expect(document?.spaces).toBe(workspaceA.spaces)
  })

  it('reads null for an unknown workspace', () => {
    expect(readWorkspaceDocument('gone')).toBeNull()
  })

  it('reads inside a recipe the state from before that recipe writes', () => {
    let seenInside: string[] | null = null

    commitCanvasDocument('a', document => {
      seenInside = readWorkspaceDocument('a')?.spaces.map(item => item.id) ?? null
      return { ...document, spaces: [space('written', [])] }
    })

    expect(seenInside).toEqual(['a-space'])
    expect(readWorkspaceDocument('a')?.spaces.map(item => item.id)).toEqual(['written'])
  })

  it('requests the registered persist flush, and does nothing when none is registered', () => {
    requestWorkspaceDocumentPersistFlush()
    expect(flush).toHaveBeenCalledTimes(1)

    unregister()
    expect(() => requestWorkspaceDocumentPersistFlush()).not.toThrow()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('keeps the shell store bound to the module', () => {
    const before = useAppStore.getState().workspaces
    setDocumentNodes('b', [])
    expect(useAppStore.getState().workspaces).not.toBe(before)
    expect(useAppStore.getState().workspaces[0]).toBe(before[0])
  })

  // S7, PR 3 (Invariant 1): the document holds no canvas-only field. Every write entry that takes
  // nodes refuses one in development (unit tests run under it), so a view node written back, or a
  // spread of one into a recipe, fails where it is written instead of reaching the document.
  describe.each(CANVAS_ONLY_FIELDS)('a write that carries %s', field => {
    const message = new RegExp(`canvas-only field "${field}"`)

    function expectRefused(write: () => void): void {
      const before = useAppStore.getState().workspaces
      const listener = vi.fn()
      const unsubscribe = useAppStore.subscribe(listener)

      expect(write).toThrow(message)
      unsubscribe()

      expect(useAppStore.getState().workspaces).toBe(before)
      expect(listener).not.toHaveBeenCalled()
      expect(flush).not.toHaveBeenCalled()
    }

    it('throws in commitCanvasDocument, and writes nothing', () => {
      expectRefused(() => {
        commitCanvasDocument(
          'a',
          document => ({
            ...document,
            nodes: document.nodes.map(node => withCanvasOnlyField(node, field)),
          }),
          { flush: true },
        )
      })
    })

    it('throws in applyRuntimeObservation, and writes nothing', () => {
      expectRefused(() => {
        applyRuntimeObservation(workspaces => ({
          nextWorkspaces: workspaces.map(item => ({
            ...item,
            nodes: item.nodes.map(node => withCanvasOnlyField(node, field)),
          })),
          didChange: true,
          durableDidChange: true,
        }))
      })
    })

    it('throws in replaceFromSync, for a workspace of the list that is not the active one', () => {
      const { workspaces } = useAppStore.getState()
      expectRefused(() => {
        replaceFromSync({
          workspaces: [
            workspaces[0],
            {
              ...workspaces[1],
              nodes: workspaces[1].nodes.map(node => withCanvasOnlyField(node, field)),
            },
          ],
          activeWorkspaceId: 'a',
        })
      })
    })

    it('throws in mergeHydratedNodes, and writes nothing', () => {
      expectRefused(() => {
        mergeHydratedNodes('a', nodes => nodes.map(node => withCanvasOnlyField(node, field)))
      })
    })
  })

  it('accepts a node that names a canvas-only field as undefined, and writes through every entry', () => {
    const clean = (node: WorkspaceState['nodes'][number]) => ({
      ...node,
      selected: undefined,
      dragHandle: undefined,
      dragging: undefined,
      data: { ...node.data, title: 'clean' },
    })

    expect(
      commitCanvasDocument('a', document => ({ ...document, nodes: document.nodes.map(clean) }))
        .status,
    ).toBe('applied')
    expect(
      applyRuntimeObservation(workspaces => ({
        nextWorkspaces: workspaces.map(item => ({ ...item, nodes: item.nodes.map(clean) })),
        didChange: true,
        durableDidChange: false,
      })),
    ).toBe(true)
    expect(mergeHydratedNodes('b', nodes => nodes.map(clean)).status).toBe('applied')
    const { workspaces } = useAppStore.getState()
    expect(() =>
      replaceFromSync({ workspaces: [...workspaces], activeWorkspaceId: 'b' }),
    ).not.toThrow()
  })
})
