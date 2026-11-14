import type { Node } from '@xyflow/react'
import { afterEach } from 'vitest'
import { useAppStore } from '../../src/app/renderer/shell/store/useAppStore'
import { bindWorkspaceDocumentStore } from '../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
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
