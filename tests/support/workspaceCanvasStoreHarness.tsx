import type { Node } from '@xyflow/react'
import { afterEach } from 'vitest'
import { useAppStore } from '../../src/app/renderer/shell/store/useAppStore'
import type { WorkspaceDocument } from '../../src/contexts/workspace/presentation/renderer/store/workspaceDocument'
import {
  bindWorkspaceDocumentStore,
  readWorkspaceDocument,
  replaceWorkspaceNodes,
  replaceWorkspaceSpaces,
} from '../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
  WorkspaceState,
} from '../../src/contexts/workspace/presentation/renderer/types'

// The canvas writes its nodes and Spaces into the app store, so its specs seed that store and read
// the document back from it. This module owns setup and teardown: specs never rebind the store.
afterEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  bindWorkspaceDocumentStore(useAppStore)
})

const DEFAULT_WORKSPACE_ID = 'workspace-1'

export function seedWorkspaceCanvasStore({
  workspaceId = DEFAULT_WORKSPACE_ID,
  nodes = [],
  spaces = [],
}: {
  workspaceId?: string
  nodes?: Node<TerminalNodeData>[]
  spaces?: WorkspaceSpaceState[]
} = {}): void {
  const workspace: WorkspaceState = {
    id: workspaceId,
    name: workspaceId,
    path: `/tmp/${workspaceId}`,
    worktreesRoot: '',
    nodes,
    spaces,
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: false,
  }
  useAppStore.setState({ workspaces: [workspace], activeWorkspaceId: workspaceId })
}

const EMPTY_NODES: Node<TerminalNodeData>[] = []

/** The nodes a canvas under test should render, read through a store selector. */
export function useWorkspaceCanvasStoreNodes(
  workspaceId = DEFAULT_WORKSPACE_ID,
): Node<TerminalNodeData>[] {
  return useAppStore(
    state => state.workspaces.find(workspace => workspace.id === workspaceId)?.nodes ?? EMPTY_NODES,
  )
}

export interface StoreBackedChannels {
  /** The store's nodes of the workspace; assigning replaces them, as a write to the store does. */
  nodesRef: { current: Node<TerminalNodeData>[] }
  /** The store's Spaces of the workspace. */
  spacesRef: { current: WorkspaceSpaceState[] }
  /** The document reader a canvas of the workspace holds: it reads the store when it is called. */
  readDocument: () => WorkspaceDocument
  /**
   * Writes the store's nodes of the workspace, as the canvas's node store does. `flush` is what
   * the node store takes to request the persistence flush on the write: `onFlush` receives it.
   */
  setNodes: (
    updater: (previous: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean; flush?: boolean },
  ) => void
}

/**
 * Seeds the app store with one workspace and returns the nodes and Spaces of the document as
 * objects with a `current`, for a spec whose assertions and whose other hooks still speak in refs
 * while the hook under test reads the document. In-place changes to the arrays go to the store's
 * own arrays, so they are visible to a reader; an assignment is a store write.
 */
export function createStoreBackedChannels({
  workspaceId,
  nodes = [],
  spaces = [],
  onFlush,
}: {
  workspaceId: string
  nodes?: Node<TerminalNodeData>[]
  spaces?: WorkspaceSpaceState[]
  onFlush?: () => void
}): StoreBackedChannels {
  seedWorkspaceCanvasStore({ workspaceId, nodes, spaces })
  return storeBackedChannelsOf(workspaceId, onFlush)
}

/** The same objects over a workspace that the spec has already seeded. */
export function storeBackedChannelsOf(
  workspaceId: string,
  onFlush?: () => void,
): StoreBackedChannels {
  const read = () => {
    const document = readWorkspaceDocument(workspaceId)
    if (!document) {
      throw new Error(`workspace ${workspaceId} is not in the store`)
    }
    return document
  }
  const nodesRef = {
    get current() {
      return read().nodes
    },
    set current(next: Node<TerminalNodeData>[]) {
      replaceWorkspaceNodes(workspaceId, next)
    },
  }
  const spacesRef = {
    get current() {
      return read().spaces
    },
    set current(next: WorkspaceSpaceState[]) {
      replaceWorkspaceSpaces(workspaceId, next)
    },
  }
  return {
    nodesRef,
    spacesRef,
    readDocument: read,
    setNodes: (updater, options) => {
      nodesRef.current = updater(nodesRef.current)
      if (options?.flush) {
        onFlush?.()
      }
    },
  }
}
