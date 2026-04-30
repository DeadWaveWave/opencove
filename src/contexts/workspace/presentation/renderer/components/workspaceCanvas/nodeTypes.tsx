import { useMemo, type MutableRefObject, type ReactElement } from 'react'
import { useStore, type Node } from '@xyflow/react'
import type { WebsiteWindowSessionMode } from '@shared/contracts/dto'
import { NoteNode } from '../NoteNode'
import { TerminalNode } from '../TerminalNode'
import type { NodeFrame, TerminalNodeData, WorkspaceSpaceState } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import { isResumeSessionBindingVerified } from '../../utils/agentResumeBinding'
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
import {
  findLinkedTaskTitleForAgent,
  providerTitlePrefix,
  resolveAgentDisplayTitle,
} from '../../utils/agentTitle'

export interface WorkspaceCanvasNodeTypeProps {
  data: TerminalNodeData
  id: string
  selected?: boolean
  dragging?: boolean
}

function TerminalNodeType({
  data,
  id,
  selected,
  dragging,
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayCalibration,
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
  renameTerminalTitleRef,
}: {
  data: TerminalNodeData
  id: string
  selected?: boolean
  dragging?: boolean
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
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
  updateNodeScrollbackRef: MutableRefObject<UpdateNodeScrollback>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
  updateTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  renameTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
}): ReactElement {
  const scrollback = useScrollbackStore(state =>
    data.kind === 'agent' ? null : (state.scrollbackByNodeId[id] ?? data.scrollback ?? null),
  )
  const nodePosition = useNodePosition(id)
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null
  const resolvedTerminalProvider =
    data.kind === 'agent' ? (data.agent?.provider ?? null) : (data.terminalProviderHint ?? null)
  const linkedTaskTitle = useStore(storeState => {
    if (data.kind !== 'agent' || !data.agent) {
      return null
    }

    const state = storeState as unknown as {
      nodeLookup?: { values?: unknown }
      nodeInternals?: { values?: unknown }
      nodes?: Array<Node<TerminalNodeData>>
    }
    const lookup = state.nodeLookup ?? state.nodeInternals
    const lookupNodes =
      lookup && typeof lookup.values === 'function'
        ? Array.from((lookup as Map<string, Node<TerminalNodeData>>).values())
        : null

    return findLinkedTaskTitleForAgent(
      lookupNodes ?? state.nodes ?? [],
      id,
      data.agent.taskId ?? null,
    )
  })
  const resolvedTitle =
    data.kind === 'agent' && data.agent
      ? resolveAgentDisplayTitle({
          provider: data.agent.provider,
          linkedTaskTitle,
          fallbackTitle: data.title,
          preferFallbackTitle: data.titlePinnedByUser === true,
        })
      : data.title

  return (
    <TerminalNode
      nodeId={id}
      sessionId={data.sessionId}
      title={resolvedTitle}
      fixedTitlePrefix={
        data.kind === 'agent' && data.agent
          ? `${providerTitlePrefix(data.agent.provider)} · `
          : null
      }
      kind={data.kind}
      labelColor={labelColor}
      agentLaunchMode={data.kind === 'agent' ? (data.agent?.launchMode ?? null) : null}
      agentExecutionDirectory={
        data.kind === 'agent' ? (data.agent?.executionDirectory ?? null) : null
      }
      agentResumeSessionId={data.kind === 'agent' ? (data.agent?.resumeSessionId ?? null) : null}
      agentResumeSessionIdVerified={
        data.kind === 'agent' && data.agent ? isResumeSessionBindingVerified(data.agent) : false
      }
      terminalProvider={resolvedTerminalProvider}
      isLiveSessionReattach={data.isLiveSessionReattach === true}
      terminalGeometry={data.terminalGeometry ?? null}
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
      terminalDisplayCalibration={terminalDisplayCalibration}
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
      onReloadSession={
        data.kind === 'agent' && data.agent
          ? async () => {
              await reloadAgentSessionRef.current(id)
            }
          : undefined
      }
      onListSessions={
        data.kind === 'agent' && data.agent
          ? async limit => {
              return await listAgentSessionsRef.current(id, limit)
            }
          : undefined
      }
      onSwitchSession={
        data.kind === 'agent' && data.agent
          ? async summary => {
              await switchAgentSessionRef.current(id, summary)
            }
          : undefined
      }
      onResize={frame => resizeNodeRef.current(id, frame)}
      onScrollbackChange={
        data.kind === 'terminal'
          ? nextScrollback => updateNodeScrollbackRef.current(id, nextScrollback)
          : undefined
      }
      onCommandRun={
        data.kind === 'terminal'
          ? command => {
              updateTerminalTitleRef.current(id, command)
            }
          : undefined
      }
      onTitleCommit={
        data.kind === 'terminal' || data.kind === 'agent'
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
  spacesRef,
  workspacePath,
  selectNode,
  clearNodeSelectionRef,
  closeNodeRef,
  resizeNodeRef,
  updateNoteTextRef,
  normalizeViewportForTerminalInteractionRef,
}: {
  data: TerminalNodeData
  id: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
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

  const containingSpace =
    spacesRef.current.find(candidate => candidate.nodeIds.includes(id)) ?? null
  const containingSpaceDirectory = containingSpace?.directoryPath.trim() ?? ''
  const saveDirectoryPath =
    containingSpaceDirectory.length > 0 ? containingSpaceDirectory : workspacePath

  return (
    <NoteNode
      text={data.note.text}
      labelColor={labelColor}
      position={nodePosition}
      width={data.width}
      height={data.height}
      saveDirectoryPath={saveDirectoryPath}
      saveMountId={containingSpace?.targetMountId ?? null}
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
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
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
  terminalDisplayCalibration,
  selectNode,
  clearNodeSelectionRef,
  closeNodeRef,
  resizeNodeRef,
  copyAgentLastMessageRef,
  reloadAgentSessionRef,
  listAgentSessionsRef,
  switchAgentSessionRef,
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
        />
      )
    }

    return {
      terminalNode: ({ data, id, selected, dragging }: WorkspaceCanvasNodeTypeProps) => {
        return (
          <TerminalNodeType
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
          <NoteNodeType
            data={data}
            id={id}
            spacesRef={spacesRef}
            workspacePath={workspacePath}
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
    terminalDisplayCalibration,
    updateNoteTextRef,
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
  ])
}
