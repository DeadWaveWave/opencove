import { useMemo, type MutableRefObject, type ReactElement } from 'react'
import type { BrowserMode, WebsiteWindowSessionMode } from '@shared/contracts/dto'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'
import type { NodeLabelColorOverride } from '@shared/types/labelColor'
import type { NodeFrame, WorkspaceSpaceState } from '../../types'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import { WorkspaceCanvasDocumentNodeType } from './nodeTypes.document'
import { WorkspaceCanvasImageNodeType } from './nodeTypes.image'
import { WorkspaceCanvasNoteNodeType } from './nodeTypes.note'
import { WorkspaceCanvasRoleNodeType } from './nodeTypes.role'
import { WorkspaceCanvasTaskNodeType } from './nodeTypes.task'
import { WorkspaceCanvasTerminalNodeType } from './nodeTypes.terminal'
import { WorkspaceCanvasWebsiteNodeType } from './nodeTypes.website'
import { useNodePosition } from './nodePosition'
import type {
  QuickUpdateTaskRequirement,
  QuickUpdateTaskTitle,
  ShowWorkspaceCanvasMessage,
  UpdateNodeScrollback,
  UpdateTaskStatus,
} from './types'
import type { WorkspaceCanvasNodeTypeProps } from './nodeTypes.types'

interface WorkspaceCanvasNodeTypesParams {
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  onShowMessage?: ShowWorkspaceCanvasMessage
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
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
  updateTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
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

export function useWorkspaceCanvasNodeTypes({
  spacesRef,
  workspacePath,
  onShowMessage,
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayCalibration,
  agentProviderOrder,
  defaultProvider,
  browserDefaultMode,
  browserSearchEngine,
  selectNode,
  convertNoteToTask,
  setNodeLabelColorOverride,
  clearNodeSelectionRef,
  closeNodeRef,
  resizeNodeRef,
  copyAgentLastMessageRef,
  reloadAgentSessionRef,
  listAgentSessionsRef,
  switchAgentSessionRef,
  updateNoteTextRef,
  renameNoteTitleRef,
  updateRoleProviderRef,
  updateRoleInputRef,
  runRoleRef,
  updateNodeScrollbackRef,
  normalizeViewportForTerminalInteractionRef,
  requestNodeDeleteRef,
  openTaskEditorRef,
  quickUpdateTaskTitleRef,
  quickUpdateTaskRequirementRef,
  runTaskAgentRef,
  resumeTaskAgentSessionRef,
  removeTaskAgentSessionRecordRef,
  updateTaskStatusRef,
  updateTerminalTitleRef,
  renameTerminalTitleRef,
  updateWebsiteUrlRef,
  setWebsitePinnedRef,
  setWebsiteSessionRef,
  setWebsiteModeRef,
  setWebsiteFullscreenRef,
}: WorkspaceCanvasNodeTypesParams): Record<
  string,
  (props: WorkspaceCanvasNodeTypeProps) => ReactElement | null
> {
  return useMemo(() => {
    const TaskNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
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

    const DocumentNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
      const nodePosition = useNodePosition(id)
      const targetMountId =
        spacesRef.current.find(candidate => candidate.nodeIds.includes(id))?.targetMountId ?? null
      return (
        <WorkspaceCanvasDocumentNodeType
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

    return {
      terminalNode: ({ data, id, selected, dragging }: WorkspaceCanvasNodeTypeProps) => {
        return (
          <WorkspaceCanvasTerminalNodeType
            data={data}
            id={id}
            selected={selected}
            dragging={dragging}
            terminalFontSize={terminalFontSize}
            terminalFontFamily={terminalFontFamily}
            terminalDisplayCalibration={terminalDisplayCalibration}
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
            renameTerminalTitleRef={renameTerminalTitleRef}
          />
        )
      },
      noteNode: ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
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
      documentNode: DocumentNodeType,
      websiteNode: WebsiteNodeType,
      imageNode: ImageNodeType,
      roleNode: ({ data, id }: WorkspaceCanvasNodeTypeProps) => (
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
      ),
      taskNode: TaskNodeType,
    }
  }, [
    clearNodeSelectionRef,
    closeNodeRef,
    normalizeViewportForTerminalInteractionRef,
    selectNode,
    spacesRef,
    workspacePath,
    onShowMessage,
    terminalFontSize,
    terminalFontFamily,
    terminalDisplayCalibration,
    agentProviderOrder,
    defaultProvider,
    browserDefaultMode,
    browserSearchEngine,
    convertNoteToTask,
    updateNoteTextRef,
    renameNoteTitleRef,
    setNodeLabelColorOverride,
    updateRoleProviderRef,
    updateRoleInputRef,
    runRoleRef,
    openTaskEditorRef,
    quickUpdateTaskRequirementRef,
    quickUpdateTaskTitleRef,
    requestNodeDeleteRef,
    resizeNodeRef,
    runTaskAgentRef,
    copyAgentLastMessageRef,
    reloadAgentSessionRef,
    listAgentSessionsRef,
    switchAgentSessionRef,
    resumeTaskAgentSessionRef,
    removeTaskAgentSessionRecordRef,
    updateNodeScrollbackRef,
    updateTaskStatusRef,
    updateTerminalTitleRef,
    renameTerminalTitleRef,
    updateWebsiteUrlRef,
    setWebsitePinnedRef,
    setWebsiteSessionRef,
    setWebsiteModeRef,
    setWebsiteFullscreenRef,
  ])
}
