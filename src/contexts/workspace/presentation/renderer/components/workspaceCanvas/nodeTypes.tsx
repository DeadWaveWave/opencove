import { useMemo, type MutableRefObject, type ReactElement } from 'react'
import type { WebsiteWindowSessionMode } from '@shared/contracts/dto'
import { NoteNode } from '../NoteNode'
import { TerminalNode } from '../TerminalNode'
import type { NodeFrame, TerminalNodeData, WorkspaceSpaceState } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import { useScrollbackStore } from '../../store/useScrollbackStore'
import { WorkspaceCanvasDocumentNodeType } from './nodeTypes.document'
import { WorkspaceCanvasImageNodeType } from './nodeTypes.image'
import { WorkspaceCanvasTaskNodeType } from './nodeTypes.task'
import { WorkspaceCanvasWebsiteNodeType } from './nodeTypes.website'
import { useNodePosition } from './nodePosition'
import type {
  QuickUpdateTaskRequirement,
  QuickUpdateTaskTitle,
  UpdateNodeScrollback,
  UpdateTaskStatus,
} from './types'

function TerminalNodeType({
  data,
  id,
  selected,
  dragging,
  terminalFontSize,
  terminalFontFamily,
  selectNode,
  closeNodeRef,
  resizeNodeRef,
  copyAgentLastMessageRef,
  updateNodeScrollbackRef,
  normalizeViewportForTerminalInteractionRef,
  updateTerminalTitleRef,
  renameTerminalTitleRef,
}: {
  data: TerminalNodeData
  id: string
  selected?: boolean
  dragging?: boolean
  terminalFontSize: number
  terminalFontFamily: string | null
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  copyAgentLastMessageRef: MutableRefObject<(nodeId: string) => Promise<void>>
  updateNodeScrollbackRef: MutableRefObject<UpdateNodeScrollback>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
  updateTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  renameTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
}): ReactElement {
  const scrollback = useScrollbackStore(state => state.scrollbackByNodeId[id] ?? null)
  const nodePosition = useNodePosition(id)
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null
  const resolvedTerminalProvider =
    data.kind === 'agent' ? (data.agent?.provider ?? null) : (data.terminalProviderHint ?? null)

  return (
    <TerminalNode
      nodeId={id}
      sessionId={data.sessionId}
      title={data.title}
      kind={data.kind}
      labelColor={labelColor}
      terminalProvider={resolvedTerminalProvider}
      terminalThemeMode="sync-with-ui"
      isSelected={selected === true}
      isDragging={dragging === true}
      status={data.status}
      directoryMismatch={
        data.kind === 'agent' &&
        data.agent?.expectedDirectory &&
        data.agent.expectedDirectory !== data.agent.executionDirectory
          ? {
              executionDirectory: data.agent.executionDirectory,
              expectedDirectory: data.agent.expectedDirectory,
            }
          : data.kind === 'terminal' &&
              data.executionDirectory &&
              data.expectedDirectory &&
              data.expectedDirectory !== data.executionDirectory
            ? {
                executionDirectory: data.executionDirectory,
                expectedDirectory: data.expectedDirectory,
              }
            : null
      }
      lastError={data.lastError}
      position={nodePosition}
      width={data.width}
      height={data.height}
      terminalFontSize={terminalFontSize}
      terminalFontFamily={terminalFontFamily}
      scrollback={scrollback}
      onClose={() => {
        void closeNodeRef.current(id)
      }}
      onCopyLastMessage={
        data.kind === 'agent' && data.agent && typeof data.startedAt === 'string'
          ? async () => {
              await copyAgentLastMessageRef.current(id)
            }
          : undefined
      }
      onResize={frame => resizeNodeRef.current(id, frame)}
      onScrollbackChange={nextScrollback => updateNodeScrollbackRef.current(id, nextScrollback)}
      onCommandRun={
        data.kind === 'terminal'
          ? command => {
              updateTerminalTitleRef.current(id, command)
            }
          : undefined
      }
      onTitleCommit={
        data.kind === 'terminal'
          ? nextTitle => {
              renameTerminalTitleRef.current(id, nextTitle)
            }
          : undefined
      }
      onInteractionStart={options => {
        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            selectNode(id, { toggle: true })
            return
          }

          selectNode(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        normalizeViewportForTerminalInteractionRef.current(id)
      }}
    />
  )
}

function NoteNodeType({
  data,
  id,
  selectNode,
  clearNodeSelectionRef,
  closeNodeRef,
  resizeNodeRef,
  updateNoteTextRef,
  normalizeViewportForTerminalInteractionRef,
}: {
  data: TerminalNodeData
  id: string
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  clearNodeSelectionRef: MutableRefObject<() => void>
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  updateNoteTextRef: MutableRefObject<(nodeId: string, text: string) => void>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
}): ReactElement | null {
  const nodePosition = useNodePosition(id)
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null

  if (!data.note) {
    return null
  }

  return (
    <NoteNode
      text={data.note.text}
      labelColor={labelColor}
      position={nodePosition}
      width={data.width}
      height={data.height}
      onClose={() => {
        void closeNodeRef.current(id)
      }}
      onResize={frame => resizeNodeRef.current(id, frame)}
      onTextChange={text => {
        updateNoteTextRef.current(id, text)
      }}
      onInteractionStart={options => {
        if (options?.clearSelection === true) {
          window.setTimeout(() => {
            clearNodeSelectionRef.current()
          }, 0)
        }

        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            selectNode(id, { toggle: true })
            return
          }

          selectNode(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        normalizeViewportForTerminalInteractionRef.current(id)
      }}
    />
  )
}

interface WorkspaceCanvasNodeTypesParams {
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  terminalFontSize: number
  terminalFontFamily: string | null
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  clearNodeSelectionRef: MutableRefObject<() => void>
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  copyAgentLastMessageRef: MutableRefObject<(nodeId: string) => Promise<void>>
  updateNoteTextRef: MutableRefObject<(nodeId: string, text: string) => void>
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
}

export function useWorkspaceCanvasNodeTypes({
  spacesRef,
  workspacePath,
  terminalFontSize,
  terminalFontFamily,
  selectNode,
  clearNodeSelectionRef,
  closeNodeRef,
  resizeNodeRef,
  copyAgentLastMessageRef,
  updateNoteTextRef,
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
}: WorkspaceCanvasNodeTypesParams): Record<
  string,
  (props: {
    data: TerminalNodeData
    id: string
    selected?: boolean
    dragging?: boolean
  }) => ReactElement | null
> {
  return useMemo(() => {
    const TaskNodeType = ({ data, id }: { data: TerminalNodeData; id: string }) => {
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

    const ImageNodeType = ({ data, id }: { data: TerminalNodeData; id: string }) => {
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

    const DocumentNodeType = ({ data, id }: { data: TerminalNodeData; id: string }) => {
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

    const WebsiteNodeType = ({ data, id }: { data: TerminalNodeData; id: string }) => {
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
        />
      )
    }

    return {
      terminalNode: ({
        data,
        id,
        selected,
        dragging,
      }: {
        data: TerminalNodeData
        id: string
        selected?: boolean
        dragging?: boolean
      }) => {
        return (
          <TerminalNodeType
            data={data}
            id={id}
            selected={selected}
            dragging={dragging}
            terminalFontSize={terminalFontSize}
            terminalFontFamily={terminalFontFamily}
            selectNode={selectNode}
            closeNodeRef={closeNodeRef}
            resizeNodeRef={resizeNodeRef}
            copyAgentLastMessageRef={copyAgentLastMessageRef}
            updateNodeScrollbackRef={updateNodeScrollbackRef}
            normalizeViewportForTerminalInteractionRef={normalizeViewportForTerminalInteractionRef}
            updateTerminalTitleRef={updateTerminalTitleRef}
            renameTerminalTitleRef={renameTerminalTitleRef}
          />
        )
      },
      noteNode: ({ data, id }: { data: TerminalNodeData; id: string }) => {
        return (
          <NoteNodeType
            data={data}
            id={id}
            selectNode={selectNode}
            clearNodeSelectionRef={clearNodeSelectionRef}
            closeNodeRef={closeNodeRef}
            resizeNodeRef={resizeNodeRef}
            updateNoteTextRef={updateNoteTextRef}
            normalizeViewportForTerminalInteractionRef={normalizeViewportForTerminalInteractionRef}
          />
        )
      },
      documentNode: DocumentNodeType,
      websiteNode: WebsiteNodeType,
      imageNode: ImageNodeType,
      taskNode: TaskNodeType,
    }
  }, [
    clearNodeSelectionRef,
    closeNodeRef,
    normalizeViewportForTerminalInteractionRef,
    selectNode,
    spacesRef,
    workspacePath,
    terminalFontSize,
    terminalFontFamily,
    updateNoteTextRef,
    openTaskEditorRef,
    quickUpdateTaskRequirementRef,
    quickUpdateTaskTitleRef,
    requestNodeDeleteRef,
    resizeNodeRef,
    runTaskAgentRef,
    copyAgentLastMessageRef,
    resumeTaskAgentSessionRef,
    removeTaskAgentSessionRecordRef,
    updateNodeScrollbackRef,
    updateTaskStatusRef,
    updateTerminalTitleRef,
    renameTerminalTitleRef,
    updateWebsiteUrlRef,
    setWebsitePinnedRef,
    setWebsiteSessionRef,
  ])
}
