import { act } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MountDto } from '@shared/contracts/dto'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  readWorkspaceDocument,
  replaceWorkspaceSpaces,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import {
  useCanvasSelectionCommands,
  useCanvasUiCommands,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { useWorkspaceCanvasSpaces } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaces'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasDocumentHarness,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const WORKSPACE_PATH = '/tmp/workspace-1'
const mount: MountDto = {
  mountId: 'mount-1',
  projectId: 'workspace-1',
  endpointId: 'local',
  targetId: 'target-1',
  rootPath: WORKSPACE_PATH,
  rootUri: `file://${WORKSPACE_PATH}`,
  name: 'Local',
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
}

function space(id: string, nodeIds: string[] = [], x = 0): WorkspaceSpaceState {
  return {
    ...createSpace(id, { x, y: 0, width: 600, height: 400 }, nodeIds),
    directoryPath: WORKSPACE_PATH,
  }
}

const reactFlow = {
  setViewport: vi.fn(),
  fitView: vi.fn(),
  getNodes: () => [] as Node<TerminalNodeData>[],
}

const onActiveSpaceChange = vi.fn()
const onShowMessage = vi.fn()

function useSpacesUnderTest({ workspaceId, nodeStore, nodes, spaces }: CanvasNodeStoreContext) {
  return {
    spacesApi: useWorkspaceCanvasSpaces({
      workspaceId,
      activeSpaceId: null,
      onActiveSpaceChange,
      workspacePath: WORKSPACE_PATH,
      focusNodeTargetZoom: 1,
      standardWindowSizeBucket: 'regular',
      reactFlow: reactFlow as unknown as ReactFlowInstance<Node<TerminalNodeData>>,
      nodes,
      updateCanvasDocument: nodeStore.updateCanvasDocument,
      spaces,
      onShowMessage,
    }),
    ui: useCanvasUiCommands(),
    selection: useCanvasSelectionCommands(),
  }
}

// Writes a Space to the store in a layout effect, which runs before the passive effect of
// `useWorkspaceCanvasSpaces` in the same commit: the `spaces` prop that effect sees is stale.
function useLateWriterThenSpaces(context: CanvasNodeStoreContext) {
  useLayoutEffect(() => {
    replaceWorkspaceSpaces(context.workspaceId, [
      ...(readStoreSpaces(context.workspaceId) ?? []),
      space('space-late', [], 900),
    ])
  }, [context.workspaceId])
  return useSpacesUnderTest(context)
}

function readStoreSpaces(workspaceId: string): WorkspaceSpaceState[] | null {
  return readWorkspaceDocument(workspaceId)?.spaces ?? null
}

function renderSpaces(harness: CanvasDocumentHarness) {
  reactFlow.setViewport.mockClear()
  onActiveSpaceChange.mockClear()
  onShowMessage.mockClear()
  const view = renderCanvasNodeStore(harness, {
    workspacePath: WORKSPACE_PATH,
    extend: useSpacesUnderTest,
  })
  return { ...view, reactFlow }
}

// The Space hooks read the committed document when a handler runs. Every case writes the store
// and calls the handler in one act, before React could commit the write to a render.
describe('useWorkspaceCanvasSpaces reads and writes the committed document', () => {
  beforeEach(() => {
    vi.stubGlobal('opencoveApi', {
      controlSurface: { invoke: vi.fn().mockResolvedValue({ mounts: [mount] }) },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('renames the store Space and keeps a Space that a write added in the same act', () => {
    const harness = createCanvasDocumentHarness({ spaces: [space('space-a')] })
    const view = renderSpaces(harness)
    act(() => {
      view.result.current.ui.startSpaceRename('space-a', 'Old')
      view.result.current.ui.setSpaceRenameDraft('Renamed')
    })

    act(() => {
      replaceWorkspaceSpaces(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        space('space-late', [], 700),
      ])
      view.result.current.spacesApi.commitSpaceRename('space-a')
    })

    expect(harness.readStoreDocument().spaces.map(item => [item.id, item.name])).toEqual([
      ['space-a', 'Renamed'],
      ['space-late', 'space-late'],
    ])
  })

  it('creates a Space from a selection in one store update and moves the nodes', async () => {
    const nodes = createRowNodes(['a', 'b'])
    const harness = createCanvasDocumentHarness({ nodes })
    const view = renderSpaces(harness)
    act(() => view.result.current.selection.setNodeIds(['a']))
    harness.notifications.mockClear()

    await act(async () => {
      view.result.current.spacesApi.createSpaceFromSelectedNodes()
    })

    const document = harness.readStoreDocument()
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(document.spaces).toHaveLength(1)
    expect(document.spaces[0].nodeIds).toEqual(['a'])
    // The new Space pushed the node beside it to the right of its rect.
    const created = document.spaces[0].rect
    expect(created).not.toBeNull()
    expect(document.nodes.find(node => node.id === 'b')?.position.x).toBeGreaterThanOrEqual(
      (created?.x ?? 0) + (created?.width ?? 0),
    )
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('creates a child Space in one store update and returns its id', () => {
    const terminals = createRowNodes(['t1']).map(node => ({
      ...node,
      data: { ...node.data, kind: 'terminal' as const, sessionId: 'session-t1' },
      position: { x: 40, y: 40 },
    }))
    const harness = createCanvasDocumentHarness({
      nodes: terminals,
      spaces: [space('parent', ['t1'])],
    })
    const view = renderSpaces(harness)
    harness.notifications.mockClear()
    let childId: string | null = null

    act(() => {
      childId = view.result.current.spacesApi.createChildSpaceInParent('parent', {
        nodeIds: ['t1'],
      })
    })

    const document = harness.readStoreDocument()
    expect(childId).toEqual(expect.any(String))
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(document.spaces.find(item => item.id === childId)?.nodeIds).toEqual(['t1'])
    expect(document.nodes[0].data.expectedDirectory).toBe(WORKSPACE_PATH)
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('finds a child Space in the call that created it', () => {
    const terminals = createRowNodes(['t1']).map(node => ({
      ...node,
      data: { ...node.data, kind: 'terminal' as const, sessionId: 'session-t1' },
      position: { x: 40, y: 40 },
    }))
    const harness = createCanvasDocumentHarness({
      nodes: terminals,
      spaces: [space('parent', ['t1'])],
    })
    const view = renderSpaces(harness)
    let focused = false

    act(() => {
      const childId = view.result.current.spacesApi.createChildSpaceInParent('parent', {
        nodeIds: ['t1'],
      })
      focused = view.result.current.spacesApi.focusSpaceInViewport(childId as string)
    })

    expect(focused).toBe(true)
  })

  it('flushes for a label colour and not for a rename', () => {
    const harness = createCanvasDocumentHarness({ spaces: [space('space-a')] })
    const view = renderSpaces(harness)

    act(() => view.result.current.spacesApi.setSpaceLabelColor('space-a', 'blue'))
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().spaces[0].labelColor).toBe('blue')

    act(() => {
      view.result.current.ui.startSpaceRename('space-a', 'Old')
      view.result.current.ui.setSpaceRenameDraft('Renamed')
    })
    act(() => view.result.current.spacesApi.commitSpaceRename('space-a'))
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().spaces[0].name).toBe('Renamed')
  })

  it('focuses a Space that was written in the same act', () => {
    const harness = createCanvasDocumentHarness({ spaces: [space('space-a')] })
    const view = renderSpaces(harness)
    let focused = false

    act(() => {
      replaceWorkspaceSpaces(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        space('space-late', [], 900),
      ])
      focused = view.result.current.spacesApi.focusSpaceInViewport('space-late')
    })

    expect(focused).toBe(true)
    expect(view.reactFlow.setViewport).toHaveBeenCalledTimes(1)
  })

  it('activates a Space that was written in the same act', () => {
    const harness = createCanvasDocumentHarness({ spaces: [space('space-a')] })
    const view = renderSpaces(harness)

    act(() => {
      replaceWorkspaceSpaces(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        space('space-late', [], 900),
      ])
      view.result.current.spacesApi.activateSpace('space-late')
    })

    expect(onActiveSpaceChange).toHaveBeenCalledExactlyOnceWith('space-late')
  })

  it('places an empty Space clear of a Space that was written in the same act', async () => {
    const harness = createCanvasDocumentHarness({ spaces: [space('space-a')] })
    const view = renderSpaces(harness)

    await act(async () => {
      replaceWorkspaceSpaces(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        space('space-late', [], 700),
      ])
      await view.result.current.spacesApi.createEmptySpaceAtPoint({ x: 1000, y: 200 })
    })

    const created = harness.readStoreDocument().spaces.find(item => item.id.length > 12)
    const rects = harness.readStoreDocument().spaces.map(item => item.rect)
    expect(created).toBeDefined()
    expect(rects).toHaveLength(3)
    const overlaps = (
      a: NonNullable<(typeof rects)[number]>,
      b: NonNullable<(typeof rects)[number]>,
    ) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    const [, late, empty] = rects as NonNullable<(typeof rects)[number]>[]
    expect(overlaps(late, empty)).toBe(false)
    expect(harness.flush).toHaveBeenCalledTimes(1)
    // The new Space is focused in the next frame, by a read of the committed Spaces.
    await act(async () => {
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    })
    expect(view.reactFlow.setViewport).toHaveBeenCalledTimes(1)
  })

  it('fills the rect of a Space without one from the nodes it owns, in one store update', () => {
    const nodes = createRowNodes(['a'])
    const harness = createCanvasDocumentHarness({
      nodes,
      spaces: [{ ...space('space-a', ['a']), rect: null }],
    })
    harness.notifications.mockClear()

    renderSpaces(harness)

    expect(harness.readStoreDocument().spaces[0].rect).not.toBeNull()
    expect(harness.notifications).toHaveBeenCalledTimes(1)
  })

  it('colours the store Space and keeps a Space that a write added in the same act', () => {
    const harness = createCanvasDocumentHarness({ spaces: [space('space-a')] })
    const view = renderSpaces(harness)

    act(() => {
      replaceWorkspaceSpaces(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        space('space-late', [], 700),
      ])
      view.result.current.spacesApi.setSpaceLabelColor('space-a', 'blue')
    })

    expect(harness.readStoreDocument().spaces.map(item => [item.id, item.labelColor])).toEqual([
      ['space-a', 'blue'],
      ['space-late', null],
    ])
  })

  describe('a failed creation writes nothing and flushes nothing', () => {
    function openPicker(view: ReturnType<typeof renderSpaces>, nodeIds: string[]) {
      act(() => {
        view.result.current.ui.openDialog('spaceTargetMountPicker', {
          nodeIds,
          rect: null,
          mounts: [mount],
          selectedMountId: mount.mountId,
          anchor: { x: 0, y: 0 },
        })
      })
    }

    it('names no node of the store', () => {
      const harness = createCanvasDocumentHarness({ nodes: createRowNodes(['a']) })
      const view = renderSpaces(harness)
      openPicker(view, ['ghost'])
      harness.notifications.mockClear()

      act(() => view.result.current.spacesApi.confirmSpaceTargetMountPicker())

      expect(harness.notifications).not.toHaveBeenCalled()
      expect(harness.flush).not.toHaveBeenCalled()
      expect(onShowMessage).toHaveBeenCalledExactlyOnceWith('messages.spaceRequiresNode', 'warning')
      expect(harness.readStoreDocument().spaces).toEqual([])
    })

    it('fails the directory validation', () => {
      const terminal = createRowNodes(['t1']).map(node => ({
        ...node,
        data: {
          ...node.data,
          kind: 'terminal' as const,
          sessionId: 'session-t1',
          executionDirectory: '/somewhere/else',
        },
      }))
      const harness = createCanvasDocumentHarness({ nodes: terminal })
      const view = renderSpaces(harness)
      openPicker(view, ['t1'])
      harness.notifications.mockClear()

      act(() => view.result.current.spacesApi.confirmSpaceTargetMountPicker())

      expect(harness.notifications).not.toHaveBeenCalled()
      expect(harness.flush).not.toHaveBeenCalled()
      expect(onShowMessage).toHaveBeenCalledExactlyOnceWith(
        'messages.terminalSpaceDirectoryMismatch',
        'warning',
      )
      expect(harness.readStoreDocument().spaces).toEqual([])
    })

    it('has no parent Space for a child', () => {
      const harness = createCanvasDocumentHarness({ spaces: [space('space-a')] })
      const view = renderSpaces(harness)
      harness.notifications.mockClear()
      let childId: string | null = 'unset'

      act(() => {
        childId = view.result.current.spacesApi.createChildSpaceInParent('missing-parent')
      })

      expect(childId).toBeNull()
      expect(harness.notifications).not.toHaveBeenCalled()
      expect(harness.flush).not.toHaveBeenCalled()
      expect(onShowMessage).toHaveBeenCalledExactlyOnceWith(
        'messages.childSpaceCreateFailed',
        'warning',
      )
    })
  })

  // `selected` exists only in the canvas view. The combined write applies its node changes to the
  // recipe's own nodes, which carry it, so it survives into the store.
  describe('keeps the canvas fields of the nodes it changes', () => {
    function terminalRow(ids: string[]) {
      return createRowNodes(ids).map(node => ({
        ...node,
        data: { ...node.data, kind: 'terminal' as const, sessionId: `session-${node.id}` },
      }))
    }

    it('when it creates a Space from a selection', async () => {
      const harness = createCanvasDocumentHarness({ nodes: terminalRow(['a']) })
      const view = renderSpaces(harness)
      act(() => view.result.current.selection.setNodeIds(['a']))
      expect(view.result.current.nodeStore.nodesRef.current[0].selected).toBe(true)

      await act(async () => {
        view.result.current.spacesApi.createSpaceFromSelectedNodes()
      })

      const [stored] = harness.readStoreDocument().nodes
      expect(stored.data.expectedDirectory).toBe(WORKSPACE_PATH)
      expect(stored.selected).toBe(true)
    })

    it('when it creates a child Space', () => {
      const nodes = terminalRow(['t1']).map(node => ({ ...node, position: { x: 40, y: 40 } }))
      const harness = createCanvasDocumentHarness({
        nodes,
        spaces: [space('parent', ['t1'])],
      })
      const view = renderSpaces(harness)
      act(() => view.result.current.selection.setNodeIds(['t1']))
      expect(view.result.current.nodeStore.nodesRef.current[0].selected).toBe(true)

      act(() => {
        view.result.current.spacesApi.createChildSpaceInParent('parent', { nodeIds: ['t1'] })
      })

      const [stored] = harness.readStoreDocument().nodes
      expect(stored.data.expectedDirectory).toBe(WORKSPACE_PATH)
      expect(stored.selected).toBe(true)
    })
  })

  describe('the rect-fill effect', () => {
    it('fills from the store Spaces, keeping one the prop does not have yet, and does not flush', () => {
      const harness = createCanvasDocumentHarness({
        nodes: createRowNodes(['a']),
        spaces: [{ ...space('space-a', ['a']), rect: null }],
      })

      renderCanvasNodeStore(harness, {
        workspacePath: WORKSPACE_PATH,
        extend: useLateWriterThenSpaces,
      })

      const stored = harness.readStoreDocument().spaces
      expect(stored.map(item => item.id)).toEqual(['space-a', 'space-late'])
      expect(stored[0].rect).not.toBeNull()
      expect(harness.flush).not.toHaveBeenCalled()
    })
  })
})
