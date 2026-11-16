import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { vi } from 'vitest'
import { useAppStore } from '../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasSpaceExplorer } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceExplorer'
import { useFilesystemNodes } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useFilesystemNodes'
import { useWorkspaceDocumentNavigation } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceDocumentNavigation'
import { useWorkspaceDocumentOpening } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceDocumentOpening'
import type { WorkspaceDocumentOpeningArgs } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceDocumentOpening'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../src/contexts/workspace/presentation/renderer/types'
import type { NodeWorkerBinding } from '../../src/shared/types/nodeWorkerBinding'
import {
  documentOf,
  renderInTwoWorkspaces,
  sized,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
  type RuntimeCanvasContext,
  type TwoWorkspaces,
} from './agentRuntimeHarness'

// Renders the explorer, the document opening, the document navigation and the filesystem nodes in
// two workspaces, as the canvas wires them: the real node store of the shown workspace supplies
// the writers and the creators, the hooks under test read the document through their own readers.
// The flush spy and the store's notification count come from `renderInTwoWorkspaces`.

export const LOCAL: NodeWorkerBinding = { endpointId: 'local', mountId: null }
export const REMOTE: NodeWorkerBinding = { endpointId: 'remote', mountId: 'remote-mount' }

function baseData(overrides: Partial<TerminalNodeData>): TerminalNodeData {
  return {
    sessionId: '',
    title: 'node',
    width: 300,
    height: 200,
    kind: 'terminal',
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    agent: null,
    task: null,
    note: null,
    image: null,
    document: null,
    website: null,
    ...overrides,
  }
}

export function documentNodeAt(
  id: string,
  uri: string,
  binding: NodeWorkerBinding = LOCAL,
  position = { x: 3000, y: 3000 },
): Node<TerminalNodeData> {
  return sized({
    id,
    type: 'documentNode',
    position,
    data: baseData({ kind: 'document', title: id, document: { uri }, workerBinding: binding }),
  })
}

export function folderNodeAt(
  id: string,
  uri: string,
  rootUri: string,
  position = { x: 3000, y: 3000 },
): Node<TerminalNodeData> {
  return sized({
    id,
    type: 'folderNode',
    position,
    data: baseData({
      kind: 'folder',
      title: id,
      workerBinding: LOCAL,
      folder: { uri, rootUri, viewMode: 'icons', expandedDirectoryUris: [] },
    }),
  })
}

export function terminalNodeAt(
  id: string,
  binding: NodeWorkerBinding = LOCAL,
  position = { x: 3000, y: 3000 },
): Node<TerminalNodeData> {
  return sized({
    id,
    type: 'terminalNode',
    position,
    data: baseData({ kind: 'terminal', sessionId: `${id}-session`, workerBinding: binding }),
  })
}

export function spaceAt(
  id: string,
  nodeIds: string[] = [],
  overrides: Partial<WorkspaceSpaceState> = {},
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: `/tmp/${id}`,
    targetMountId: null,
    labelColor: null,
    nodeIds,
    rect: { x: 0, y: 0, width: 1200, height: 900 },
    ...overrides,
  }
}

/** A React Flow instance for a hook that only centres the viewport and converts points. */
export function reactFlowStub() {
  return {
    getZoom: () => 1,
    setCenter: vi.fn(),
    setViewport: vi.fn(),
    screenToFlowPosition: (point: { x: number; y: number }) => point,
  } as unknown as WorkspaceDocumentOpeningArgs['reactFlow']
}

type Documents = Parameters<typeof renderInTwoWorkspaces>[1]

export interface ExplorerRenderOptions {
  /**
   * Gives the hook the workspace id of workspace A for every render. Several callbacks list the id
   * among their dependencies, so a case that has to see the reader change on its own keeps it fixed.
   */
  fixedWorkspaceId?: boolean
}

function shownId(context: RuntimeCanvasContext, { fixedWorkspaceId }: ExplorerRenderOptions) {
  return fixedWorkspaceId ? A : context.workspaceId
}

/**
 * `expandNode` as the collapse owner answers it: the node of the store, expanded as it is. One
 * function for every render, so that it cannot rebuild a callback that depends on it.
 */
function stableExpandNode() {
  return vi.fn((id: string) =>
    [A, B].flatMap(workspaceId => documentOf(workspaceId).nodes).find(node => node.id === id),
  )
}

export function renderOpening(documents?: Documents, options: ExplorerRenderOptions = {}) {
  const reactFlow = reactFlowStub()
  const expandNode = stableExpandNode()
  const rendered = renderInTwoWorkspaces(context => {
    const workspaceId = shownId(context, options)
    return useWorkspaceDocumentOpening({
      workspaceId,
      setNodes: context.stableSetNodes,
      updateCanvasDocument: context.stableUpdateCanvasDocument,
      reactFlow,
      createDocumentNode: context.nodeStore.createDocumentNode,
      expandNode,
    })
  }, documents)
  return { ...rendered, reactFlow, expandNode }
}

export function renderNavigation(
  documents?: Documents,
  options: ExplorerRenderOptions & { openExplorerSpaceId?: string | null } = {},
) {
  const reactFlow = reactFlowStub()
  const expandNode = stableExpandNode()
  const openSpaceExplorer = vi.fn()
  const rendered = renderInTwoWorkspaces(context => {
    const workspaceId = shownId(context, options)
    return useWorkspaceDocumentNavigation({
      workspaceId,
      setNodes: context.stableSetNodes,
      updateCanvasDocument: context.stableUpdateCanvasDocument,
      reactFlow,
      createDocumentNode: context.nodeStore.createDocumentNode,
      expandNode,
      openSpaceExplorer,
      openExplorerSpaceId: options.openExplorerSpaceId ?? null,
    })
  }, documents)
  return { ...rendered, reactFlow, openSpaceExplorer }
}

export function renderFilesystemNodes(documents?: Documents, options: ExplorerRenderOptions = {}) {
  const onShowMessage = vi.fn()
  const rendered = renderInTwoWorkspaces(context => {
    const workspaceId = shownId(context, options)
    return useFilesystemNodes({
      workspaceId,
      workspacePath: `/tmp/${workspaceId}`,
      nodeStore: {
        setNodes: context.stableSetNodes,
        updateCanvasDocument: context.stableUpdateCanvasDocument,
        createDocumentNode: context.nodeStore.createDocumentNode,
        createFolderNode: context.nodeStore.createFolderNode,
      },
      onShowMessage,
    })
  }, documents)
  return { ...rendered, onShowMessage }
}

export function renderExplorer(documents?: Documents, options: ExplorerRenderOptions = {}) {
  const reactFlow = reactFlowStub()
  const canvasRef = { current: document.createElement('div') }
  const nodeDragSession = {
    beginNodeDragSession: vi.fn(),
    endNodeDragSession: vi.fn(),
    clearNodeDragProjection: vi.fn(),
    projectNodeDrag: vi.fn(({ currentNodes }: { currentNodes: Node<TerminalNodeData>[] }) => ({
      nextNodes: currentNodes,
      nextDraggedNodePositionById: new Map(),
    })),
    dragBaselinePositionByIdRef: { current: new Map() },
    dragBaselineSpaceRectByIdRef: { current: new Map() },
  }
  const finalizeDraggedNodeDrop = vi.fn()
  const expandNode = stableExpandNode()
  const rendered = renderInTwoWorkspaces(context => {
    const workspaceId = shownId(context, options)
    return useWorkspaceCanvasSpaceExplorer({
      workspaceId,
      canvasRef,
      spaces: context.canvasState.spacesRef.current,
      setNodes: context.stableSetNodes,
      updateCanvasDocument: context.stableUpdateCanvasDocument,
      reactFlow: reactFlow as never,
      nodeDragSession: nodeDragSession as never,
      finalizeDraggedNodeDrop,
      createDocumentNode: context.nodeStore.createDocumentNode,
      createImageNode: context.nodeStore.createImageNode,
      expandNode,
      standardWindowSizeBucket: 'regular',
    })
  }, documents)
  return { ...rendered, reactFlow, nodeDragSession, finalizeDraggedNodeDrop }
}

/** Shows workspace B in the app store while the hook stays rendered under workspace A. */
export function displayBWhileRenderingA({ view }: Pick<TwoWorkspaces<unknown>, 'view'>): void {
  act(() => {
    useAppStore.setState({ activeWorkspaceId: B })
    view.rerender()
  })
}
