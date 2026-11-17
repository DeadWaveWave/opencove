import { renderHook, type RenderHookResult } from '@testing-library/react'
import { ReactFlowProvider, type Node } from '@xyflow/react'
import React, { type ReactNode } from 'react'
import { afterEach, vi, type Mock } from 'vitest'
import { useAppStore } from '../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasNodePublishers } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodePublishers'
import { useWorkspaceCanvasState } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasState'
import { useWorkspaceCanvasNodesStore } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import {
  readWorkspaceDocument,
  registerWorkspaceDocumentPersistFlush,
} from '../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { WorkspaceDocument } from '../../src/contexts/workspace/presentation/renderer/store/workspaceDocument'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../src/contexts/workspace/presentation/renderer/types'
import {
  useCanvasDocumentCommands,
  useReadCanvasDocument,
  type CanvasDocumentCommands,
} from '../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { CanvasStoreTestProvider } from './canvasStoreTestHarness'
import {
  seedWorkspaceCanvasStore,
  useWorkspaceCanvasStoreNodes,
} from './workspaceCanvasStoreHarness'

export const CANVAS_DOCUMENT_WORKSPACE_ID = 'workspace-1'

export interface CanvasDocumentHarness {
  workspaceId: string
  /** The persist flush the shell registered with the document module. */
  flush: Mock
  /** Called once for each write to the app store, whichever field it changes. */
  notifications: Mock
  /** The workspace's document as the store holds it now. */
  readStoreDocument: () => WorkspaceDocument
}

const disposers: Array<() => void> = []

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.()
  }
})

/**
 * Seeds the app store with one workspace, binds a persist-flush spy through the document module
 * and counts store notifications. Teardown runs after each test.
 */
export function createCanvasDocumentHarness({
  workspaceId = CANVAS_DOCUMENT_WORKSPACE_ID,
  nodes = [],
  spaces = [],
}: {
  workspaceId?: string
  nodes?: Node<TerminalNodeData>[]
  spaces?: WorkspaceSpaceState[]
} = {}): CanvasDocumentHarness {
  seedWorkspaceCanvasStore({ workspaceId, nodes, spaces })
  const flush = vi.fn()
  const notifications = vi.fn()
  disposers.push(registerWorkspaceDocumentPersistFlush(flush))
  disposers.push(useAppStore.subscribe(notifications))
  return {
    workspaceId,
    flush,
    notifications,
    readStoreDocument: () => {
      const document = readWorkspaceDocument(workspaceId)
      if (!document) {
        throw new Error(`workspace ${workspaceId} is not in the store`)
      }
      return document
    },
  }
}

function createWrapper(
  workspaceId: string | (() => string),
  magneticSnapping: boolean,
): (props: { children: ReactNode }) => React.ReactElement {
  return function Wrapper({ children }) {
    return (
      <CanvasStoreTestProvider
        workspaceId={typeof workspaceId === 'function' ? workspaceId() : workspaceId}
        magneticSnapping={magneticSnapping}
      >
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </CanvasStoreTestProvider>
    )
  }
}

/**
 * `renderHook` under the canvas store provider of `workspaceId` and a React Flow store. A function
 * is read on every render, so a test switches workspace by changing what it returns and calling
 * `rerender`. Magnetic snapping starts off unless `magneticSnapping` is true.
 */
export function renderInCanvasDocument<Result, Props = undefined>(
  callback: (props: Props) => Result,
  options: {
    workspaceId?: string | (() => string)
    initialProps?: Props
    magneticSnapping?: boolean
  } = {},
): RenderHookResult<Result, Props> {
  return renderHook(callback, {
    initialProps: options.initialProps,
    wrapper: createWrapper(
      options.workspaceId ?? CANVAS_DOCUMENT_WORKSPACE_ID,
      options.magneticSnapping === true,
    ),
  })
}

/**
 * The document commands a canvas of `workspaceId` would hold, for a function under test that takes
 * them as an argument. They write the workspace of the render that made them.
 */
export function renderCanvasDocumentCommands(workspaceId: string): CanvasDocumentCommands {
  return renderInCanvasDocument(() => useCanvasDocumentCommands(), { workspaceId }).result.current
}

/**
 * The document reader a canvas of `workspaceId` would hold, for a function under test that takes it
 * as an argument. It reads the workspace of the render that made it.
 */
export function renderCanvasDocumentReader(workspaceId: string): () => WorkspaceDocument {
  return renderInCanvasDocument(() => useReadCanvasDocument(), { workspaceId }).result.current
}

const EMPTY_SPACES: WorkspaceSpaceState[] = []

export interface CanvasNodeStoreContext {
  workspaceId: string
  canvasState: ReturnType<typeof useWorkspaceCanvasState>
  nodeStore: ReturnType<typeof useWorkspaceCanvasNodesStore>
  publishers: ReturnType<typeof useWorkspaceCanvasNodePublishers>
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
}

/**
 * The canvas state and the node store, wired as `WorkspaceCanvasInner` wires them: the canvas view
 * comes from the store through a selector, so a store write reaches `flowNodes` after a commit.
 * `extend` runs inside the same render, for the hook under test that takes them as arguments; it
 * must be a function named `use...`, because it calls hooks.
 */
export function renderCanvasNodeStore<Extra extends object = Record<never, never>>(
  harness: CanvasDocumentHarness,
  {
    workspacePath = `/tmp/${harness.workspaceId}`,
    nodeStoreOptions,
    magneticSnapping,
    extend,
  }: {
    workspacePath?: string
    magneticSnapping?: boolean
    /** Further parameters of the node store, such as `onShowMessage`. */
    nodeStoreOptions?: Partial<
      Pick<
        Parameters<typeof useWorkspaceCanvasNodesStore>[0],
        'onShowMessage' | 'browserDefaultMode' | 'standardWindowSizeBucket'
      >
    >
    extend?: (context: CanvasNodeStoreContext) => Extra
  } = {},
) {
  return renderInCanvasDocument(
    () => {
      const nodes = useWorkspaceCanvasStoreNodes(harness.workspaceId)
      const spaces = useAppStore(
        state =>
          state.workspaces.find(workspace => workspace.id === harness.workspaceId)?.spaces ??
          EMPTY_SPACES,
      )
      const canvasState = useWorkspaceCanvasState({
        workspaceId: harness.workspaceId,
        nodes,
        spaces,
        viewport: { x: 0, y: 0, zoom: 1 },
      })
      const publishers = useWorkspaceCanvasNodePublishers({
        ...canvasState,
        workspaceId: harness.workspaceId,
      })
      const nodeStore = useWorkspaceCanvasNodesStore({
        workspaceId: harness.workspaceId,
        workspacePath,
        nodes: canvasState.flowNodes,
        onNodesCommitted: publishers.publishCommittedNodes,
        isLiveGestureActive: publishers.isLiveGestureActive,
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
        ...nodeStoreOptions,
      })
      const context = {
        workspaceId: harness.workspaceId,
        canvasState,
        nodeStore,
        publishers,
        nodes,
        spaces,
      }
      return { ...context, ...(extend ? extend(context) : ({} as Extra)) }
    },
    { workspaceId: harness.workspaceId, magneticSnapping },
  )
}
