import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type MutableRefObject,
  type FunctionComponent,
} from 'react'
import type { BrowserMode, WebsiteWindowSessionMode } from '@shared/contracts/dto'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'
import type { NodeLabelColorOverride } from '@shared/types/labelColor'
import type { NodeFrame, WorkspaceSpaceState } from '../../types'
import { WorkspaceCanvasDocumentNodeType } from './nodeTypes.document'
import { WorkspaceCanvasFolderNodeType } from './nodeTypes.folder'
import { resolveFilesystemNodeMountId } from './filesystemNodeBinding'
import { WorkspaceCanvasImageNodeType } from './nodeTypes.image'
import { WorkspaceCanvasNoteNodeType } from './nodeTypes.note'
import { WorkspaceCanvasRoleNodeType } from './nodeTypes.role'
import { WorkspaceCanvasTaskNodeType } from './nodeTypes.task'
import { WorkspaceCanvasTerminalNodeType } from './nodeTypes.terminal'
import { WorkspaceCanvasWebsiteNodeType } from './nodeTypes.website'
import { WorkspaceCanvasPluginNodeType } from './nodeTypes.plugin'
import { useNodePosition } from './nodePosition'
import type {
  QuickUpdateTaskRequirement,
  QuickUpdateTaskTitle,
  ShowWorkspaceCanvasMessage,
  UpdateNodeScrollback,
  UpdateTaskStatus,
} from './types'
import type { WorkspaceCanvasNodeTypeProps } from './nodeTypes.types'
import { useTerminalDisplayAlignment } from './TerminalDisplayAlignmentContext'
import { WindowCollapsePresentation } from './collapse/WindowCollapsePresentation'

interface WorkspaceCanvasNodeTypesParams {
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  onShowMessage?: ShowWorkspaceCanvasMessage
  agentProviderOrder: AgentProvider[]
  defaultProvider: AgentProvider
  browserDefaultMode: BrowserMode
  browserSearchEngine: BrowserSearchEngineId
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  convertNoteToTask: (nodeId: string) => boolean
  setNodeLabelColorOverride: (nodeIds: string[], labelColorOverride: NodeLabelColorOverride) => void
  clearNodeSelectionRef: MutableRefObject<() => void>
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  copyAgentLastMessageRef: MutableRefObject<(nodeId: string) => Promise<void>>
  reloadAgentSessionRef: MutableRefObject<(nodeId: string) => Promise<void>>
  listAgentSessionsRef: MutableRefObject<
    (
      nodeId: string,
      limit?: number,
    ) => Promise<import('@shared/contracts/dto').AgentSessionSummary[]>
  >
  switchAgentSessionRef: MutableRefObject<
    (nodeId: string, summary: import('@shared/contracts/dto').AgentSessionSummary) => Promise<void>
  >
  updateNoteTextRef: MutableRefObject<(nodeId: string, text: string) => void>
  renameNoteTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  updateRoleProviderRef: MutableRefObject<(nodeId: string, provider: AgentProvider) => void>
  updateRoleInputRef: MutableRefObject<(nodeId: string, input: string) => void>
  runRoleRef: MutableRefObject<(nodeId: string, inputOverride?: string) => Promise<void>>
  updateNodeScrollbackRef: MutableRefObject<UpdateNodeScrollback>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
  requestNodeDeleteRef: MutableRefObject<(nodeIds: string[]) => void>
  openTaskEditorRef: MutableRefObject<(nodeId: string) => void>
  quickUpdateTaskTitleRef: MutableRefObject<QuickUpdateTaskTitle>
  quickUpdateTaskRequirementRef: MutableRefObject<QuickUpdateTaskRequirement>
  runTaskAgentRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resumeTaskAgentSessionRef: MutableRefObject<
    (taskNodeId: string, recordId: string) => Promise<void>
  >
  removeTaskAgentSessionRecordRef: MutableRefObject<(taskNodeId: string, recordId: string) => void>
  updateTaskStatusRef: MutableRefObject<UpdateTaskStatus>
  updateTerminalTitleRef: MutableRefObject<
    (nodeId: string, title: string, startedAtMs?: number) => void
  >
  clearTerminalAgentOverlayRef: MutableRefObject<
    (nodeId: string, expectedStartedAtMs?: number) => void
  >
  renameTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  updateWebsiteUrlRef: MutableRefObject<(nodeId: string, url: string) => void>
  setWebsitePinnedRef: MutableRefObject<(nodeId: string, pinned: boolean) => void>
  setWebsiteSessionRef: MutableRefObject<
    (nodeId: string, sessionMode: WebsiteWindowSessionMode, profileId: string | null) => void
  >
  setWebsiteModeRef: MutableRefObject<(nodeId: string, browserMode: BrowserMode) => void>
  setWebsiteFullscreenRef: MutableRefObject<
    (
      nodeId: string,
      frame: NodeFrame,
      previousFrame: NodeFrame | null,
      isFullscreen: boolean,
    ) => void
  >
}

export function useWorkspaceCanvasNodeTypes(
  params: WorkspaceCanvasNodeTypesParams,
): Record<string, FunctionComponent<WorkspaceCanvasNodeTypeProps>> {
  // React Flow remounts every node whose type component changes identity. The node types are
  // therefore created once per canvas; the values they use are read from a store, so a project
  // switch or a new callback re-renders nodes instead of rebuilding them (and their terminals).
  const storeRef = useRef<NodeTypeParamsStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createNodeTypeParamsStore(params)
  }
  const store = storeRef.current
  useLayoutEffect(() => {
    store.set(params)
  })
  return useMemo(() => createWorkspaceCanvasNodeTypes(store), [store])
}

type NodeTypeParamsStore = {
  get: () => WorkspaceCanvasNodeTypesParams
  set: (next: WorkspaceCanvasNodeTypesParams) => void
  subscribe: (listener: () => void) => () => void
}

function createNodeTypeParamsStore(initial: WorkspaceCanvasNodeTypesParams): NodeTypeParamsStore {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    set: next => {
      const keys = new Set([...Object.keys(snapshot), ...Object.keys(next)]) as Set<
        keyof WorkspaceCanvasNodeTypesParams
      >
      const changed = [...keys].some(key => !Object.is(snapshot[key], next[key]))
      if (!changed) {
        return
      }
      snapshot = next
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function createWorkspaceCanvasNodeTypes(
  store: NodeTypeParamsStore,
): Record<string, FunctionComponent<WorkspaceCanvasNodeTypeProps>> {
  const useNodeTypeParams = (): WorkspaceCanvasNodeTypesParams =>
    useSyncExternalStore(store.subscribe, store.get, store.get)

  const TaskNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const {
      spacesRef,
      workspacePath,
      selectNode,
      resizeNodeRef,
      normalizeViewportForTerminalInteractionRef,
      requestNodeDeleteRef,
      openTaskEditorRef,
      quickUpdateTaskTitleRef,
      quickUpdateTaskRequirementRef,
      runTaskAgentRef,
      resumeTaskAgentSessionRef,
      removeTaskAgentSessionRecordRef,
      updateTaskStatusRef,
    } = useNodeTypeParams()
    const nodePosition = useNodePosition(id)

    return (
      <WorkspaceCanvasTaskNodeType
        data={data}
        id={id}
        nodePosition={nodePosition}
        spacesRef={spacesRef}
        workspacePath={workspacePath}
        selectNode={selectNode}
        resizeNodeRef={resizeNodeRef}
        normalizeViewportForTerminalInteractionRef={normalizeViewportForTerminalInteractionRef}
        requestNodeDeleteRef={requestNodeDeleteRef}
        openTaskEditorRef={openTaskEditorRef}
        quickUpdateTaskTitleRef={quickUpdateTaskTitleRef}
        quickUpdateTaskRequirementRef={quickUpdateTaskRequirementRef}
        runTaskAgentRef={runTaskAgentRef}
        resumeTaskAgentSessionRef={resumeTaskAgentSessionRef}
        removeTaskAgentSessionRecordRef={removeTaskAgentSessionRecordRef}
        updateTaskStatusRef={updateTaskStatusRef}
      />
    )
  }

  const ImageNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const { selectNode, closeNodeRef, resizeNodeRef, normalizeViewportForTerminalInteractionRef } =
      useNodeTypeParams()
    const nodePosition = useNodePosition(id)
    return (
      <WorkspaceCanvasImageNodeType
        data={data}
        id={id}
        nodePosition={nodePosition}
        selectNode={selectNode}
        closeNodeRef={closeNodeRef}
        resizeNodeRef={resizeNodeRef}
        normalizeViewportForTerminalInteractionRef={normalizeViewportForTerminalInteractionRef}
      />
    )
  }

  const FilesystemNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const {
      spacesRef,
      selectNode,
      clearNodeSelectionRef,
      closeNodeRef,
      resizeNodeRef,
      normalizeViewportForTerminalInteractionRef,
    } = useNodeTypeParams()
    const nodePosition = useNodePosition(id)
    const targetMountId = resolveFilesystemNodeMountId(id, data, spacesRef.current)
    const Component =
      data.kind === 'folder' ? WorkspaceCanvasFolderNodeType : WorkspaceCanvasDocumentNodeType
    return (
      <Component
        data={data}
        id={id}
        nodePosition={nodePosition}
        mountId={targetMountId}
        selectNode={selectNode}
        clearNodeSelectionRef={clearNodeSelectionRef}
        closeNodeRef={closeNodeRef}
        resizeNodeRef={resizeNodeRef}
        normalizeViewportForTerminalInteractionRef={normalizeViewportForTerminalInteractionRef}
      />
    )
  }

  const WebsiteNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const {
      browserDefaultMode,
      browserSearchEngine,
      selectNode,
      closeNodeRef,
      resizeNodeRef,
      normalizeViewportForTerminalInteractionRef,
      updateWebsiteUrlRef,
      setWebsitePinnedRef,
      setWebsiteSessionRef,
      setWebsiteModeRef,
      setWebsiteFullscreenRef,
    } = useNodeTypeParams()
    const nodePosition = useNodePosition(id)
    return (
      <WorkspaceCanvasWebsiteNodeType
        data={data}
        id={id}
        nodePosition={nodePosition}
        selectNode={selectNode}
        closeNodeRef={closeNodeRef}
        resizeNodeRef={resizeNodeRef}
        normalizeViewportForTerminalInteractionRef={normalizeViewportForTerminalInteractionRef}
        updateWebsiteUrlRef={updateWebsiteUrlRef}
        setWebsitePinnedRef={setWebsitePinnedRef}
        setWebsiteSessionRef={setWebsiteSessionRef}
        setWebsiteModeRef={setWebsiteModeRef}
        setWebsiteFullscreenRef={setWebsiteFullscreenRef}
        browserDefaultMode={browserDefaultMode}
        browserSearchEngine={browserSearchEngine}
      />
    )
  }

  const TerminalNodeType = ({ data, id, selected, dragging }: WorkspaceCanvasNodeTypeProps) => {
    const {
      selectNode,
      closeNodeRef,
      resizeNodeRef,
      copyAgentLastMessageRef,
      reloadAgentSessionRef,
      listAgentSessionsRef,
      switchAgentSessionRef,
      updateNodeScrollbackRef,
      normalizeViewportForTerminalInteractionRef,
      updateTerminalTitleRef,
      clearTerminalAgentOverlayRef,
      renameTerminalTitleRef,
    } = useNodeTypeParams()
    const displayAlignment = useTerminalDisplayAlignment()
    return (
      <WorkspaceCanvasTerminalNodeType
        data={data}
        id={id}
        selected={selected}
        dragging={dragging}
        terminalFontSize={displayAlignment.terminalFontSize}
        terminalFontFamily={displayAlignment.terminalFontFamily}
        terminalTransparentBackground={displayAlignment.terminalTransparentBackground}
        terminalDisplayCalibration={displayAlignment.terminalDisplayCalibration}
        selectNode={selectNode}
        closeNodeRef={closeNodeRef}
        resizeNodeRef={resizeNodeRef}
        copyAgentLastMessageRef={copyAgentLastMessageRef}
        reloadAgentSessionRef={reloadAgentSessionRef}
        listAgentSessionsRef={listAgentSessionsRef}
        switchAgentSessionRef={switchAgentSessionRef}
        updateNodeScrollbackRef={updateNodeScrollbackRef}
        normalizeViewportForTerminalInteractionRef={normalizeViewportForTerminalInteractionRef}
        updateTerminalTitleRef={updateTerminalTitleRef}
        clearTerminalAgentOverlayRef={clearTerminalAgentOverlayRef}
        renameTerminalTitleRef={renameTerminalTitleRef}
      />
    )
  }

  const nodeTypes = {
    terminalNode: TerminalNodeType,
    noteNode: function NoteNodeType({ data, id }: WorkspaceCanvasNodeTypeProps) {
      const {
        onShowMessage,
        selectNode,
        convertNoteToTask,
        setNodeLabelColorOverride,
        clearNodeSelectionRef,
        closeNodeRef,
        resizeNodeRef,
        updateNoteTextRef,
        renameNoteTitleRef,
        normalizeViewportForTerminalInteractionRef,
      } = useNodeTypeParams()
      return (
        <WorkspaceCanvasNoteNodeType
          data={data}
          id={id}
          selectNode={selectNode}
          clearNodeSelectionRef={clearNodeSelectionRef}
          closeNodeRef={closeNodeRef}
          resizeNodeRef={resizeNodeRef}
          updateNoteTextRef={updateNoteTextRef}
          renameNoteTitleRef={renameNoteTitleRef}
          convertNoteToTask={convertNoteToTask}
          setNodeLabelColorOverride={setNodeLabelColorOverride}
          normalizeViewportForTerminalInteractionRef={normalizeViewportForTerminalInteractionRef}
          onShowMessage={onShowMessage}
        />
      )
    },
    documentNode: FilesystemNodeType,
    folderNode: FilesystemNodeType,
    websiteNode: WebsiteNodeType,
    pluginNode: function PluginNodeType({ data, id }: WorkspaceCanvasNodeTypeProps) {
      const {
        selectNode,
        closeNodeRef,
        resizeNodeRef,
        normalizeViewportForTerminalInteractionRef,
      } = useNodeTypeParams()
      return (
        <WorkspaceCanvasPluginNodeType
          data={data}
          id={id}
          closeNodeRef={closeNodeRef}
          resizeNodeRef={resizeNodeRef}
          selectNode={selectNode}
          normalizeViewportForTerminalInteractionRef={normalizeViewportForTerminalInteractionRef}
        />
      )
    },
    imageNode: ImageNodeType,
    roleNode: function RoleNodeType({ data, id }: WorkspaceCanvasNodeTypeProps) {
      const {
        agentProviderOrder,
        defaultProvider,
        selectNode,
        resizeNodeRef,
        updateRoleProviderRef,
        updateRoleInputRef,
        runRoleRef,
        normalizeViewportForTerminalInteractionRef,
        requestNodeDeleteRef,
      } = useNodeTypeParams()
      return (
        <WorkspaceCanvasRoleNodeType
          data={data}
          id={id}
          selectNode={selectNode}
          requestNodeDeleteRef={requestNodeDeleteRef}
          resizeNodeRef={resizeNodeRef}
          updateRoleProviderRef={updateRoleProviderRef}
          updateRoleInputRef={updateRoleInputRef}
          runRoleRef={runRoleRef}
          normalizeViewportForTerminalInteractionRef={normalizeViewportForTerminalInteractionRef}
          agentProviderOrder={agentProviderOrder}
          defaultProvider={defaultProvider}
        />
      )
    },
    taskNode: TaskNodeType,
  }
  return Object.fromEntries(
    Object.entries(nodeTypes).map(([type, NodeComponent]) => [
      type,
      memo(function CollapsibleNodeType(props: WorkspaceCanvasNodeTypeProps) {
        const { selectNode } = useNodeTypeParams()
        return (
          <WindowCollapsePresentation
            id={props.id}
            data={props.data}
            onToggleSelection={() => selectNode(props.id, { toggle: true })}
            onSelect={() => selectNode(props.id)}
          >
            <NodeComponent {...props} />
          </WindowCollapsePresentation>
        )
      }),
    ]),
  )
}
