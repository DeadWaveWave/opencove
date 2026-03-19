import { useMemo, type MutableRefObject, type ReactElement } from 'react'
import { useStore, type Node } from '@xyflow/react'
import { NoteNode } from '../NoteNode'
import { TaskNode } from '../TaskNode'
import { TerminalNode } from '../TerminalNode'
import type { NodeFrame, TerminalNodeData, WorkspaceSpaceState } from '../../types'
import { useScrollbackStore } from '../../store/useScrollbackStore'
import type {
  QuickUpdateTaskRequirement,
  QuickUpdateTaskTitle,
  UpdateNodeScrollback,
  UpdateTaskStatus,
} from './types'

function useNodePosition(nodeId: string): { x: number; y: number } {
  return useStore(storeState => {
    const state = storeState as unknown as {
      nodeLookup?: { get?: unknown }
      nodeInternals?: { get?: unknown }
      nodes?: Array<Node<TerminalNodeData>>
    }

    const lookup = state.nodeLookup ?? state.nodeInternals
    if (lookup && typeof lookup.get === 'function') {
      const node = (lookup as Map<string, Node<TerminalNodeData>>).get(nodeId) ?? null
      if (node) {
        return node.position
      }
    }

    return state.nodes?.find(node => node.id === nodeId)?.position ?? { x: 0, y: 0 }
  })
}

function TerminalNodeType({
  data,
  id,
  selected,
  dragging,
  terminalFontSize,
  selectNode,
  closeNodeRef,
  resizeNodeRef,
  saveAgentLastMessageToNoteRef,
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
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  saveAgentLastMessageToNoteRef: MutableRefObject<(nodeId: string) => Promise<void>>
  updateNodeScrollbackRef: MutableRefObject<UpdateNodeScrollback>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
  updateTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  renameTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
}): ReactElement {
  const scrollback = useScrollbackStore(state => state.scrollbackByNodeId[id] ?? null)
  const nodePosition = useNodePosition(id)

  return (
    <TerminalNode
      nodeId={id}
      sessionId={data.sessionId}
      title={data.title}
      kind={data.kind}
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
      scrollback={scrollback}
      onClose={() => {
        void closeNodeRef.current(id)
      }}
      onSaveLastMessageToNote={
        data.kind === 'agent' && data.agent && typeof data.startedAt === 'string'
          ? async () => {
              await saveAgentLastMessageToNoteRef.current(id)
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

  if (!data.note) {
    return null
  }

  return (
    <NoteNode
      text={data.note.text}
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
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  clearNodeSelectionRef: MutableRefObject<() => void>
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  saveAgentLastMessageToNoteRef: MutableRefObject<(nodeId: string) => Promise<void>>
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
}

export function useWorkspaceCanvasNodeTypes({
  spacesRef,
  workspacePath,
  terminalFontSize,
  selectNode,
  clearNodeSelectionRef,
  closeNodeRef,
  resizeNodeRef,
  saveAgentLastMessageToNoteRef,
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
      const linkedAgentNodeId = data.task?.linkedAgentNodeId ?? null
      const nodePosition = useNodePosition(id)
      const linkedAgentNode = useStore(storeState => {
        if (!linkedAgentNodeId) {
          return null
        }

        const state = storeState as unknown as {
          nodeLookup?: { get?: unknown }
          nodeInternals?: { get?: unknown }
          nodes?: Array<Node<TerminalNodeData>>
        }

        const lookup = state.nodeLookup ?? state.nodeInternals
        if (lookup && typeof lookup.get === 'function') {
          return (lookup as Map<string, Node<TerminalNodeData>>).get(linkedAgentNodeId) ?? null
        }

        return state.nodes?.find(node => node.id === linkedAgentNodeId) ?? null
      })

      if (!data.task) {
        return null
      }

      const taskSpace = spacesRef.current.find(space => space.nodeIds.includes(id)) ?? null
      const currentDirectory =
        taskSpace && taskSpace.directoryPath.trim().length > 0
          ? taskSpace.directoryPath
          : workspacePath

      const linkedAgentSummary =
        linkedAgentNode && linkedAgentNode.data.kind === 'agent' && linkedAgentNode.data.agent
          ? {
              nodeId: linkedAgentNode.id,
              title: linkedAgentNode.data.title,
              provider: linkedAgentNode.data.agent.provider,
              status: linkedAgentNode.data.status,
              startedAt: linkedAgentNode.data.startedAt,
            }
          : null

      return (
        <TaskNode
          title={data.title}
          requirement={data.task.requirement}
          status={data.task.status}
          priority={data.task.priority}
          tags={data.task.tags}
          isEnriching={data.task.isEnriching === true}
          linkedAgentNode={linkedAgentSummary}
          agentSessions={data.task.agentSessions ?? []}
          currentDirectory={currentDirectory}
          position={nodePosition}
          width={data.width}
          height={data.height}
          onClose={() => {
            requestNodeDeleteRef.current([id])
          }}
          onOpenEditor={() => {
            openTaskEditorRef.current(id)
          }}
          onQuickTitleSave={title => {
            quickUpdateTaskTitleRef.current(id, title)
          }}
          onQuickRequirementSave={requirement => {
            quickUpdateTaskRequirementRef.current(id, requirement)
          }}
          onRunAgent={() => {
            void runTaskAgentRef.current(id)
          }}
          onResize={frame => resizeNodeRef.current(id, frame)}
          onStatusChange={status => {
            updateTaskStatusRef.current(id, status)
          }}
          onResumeAgentSession={recordId => {
            void resumeTaskAgentSessionRef.current(id, recordId)
          }}
          onRemoveAgentSessionRecord={recordId => {
            removeTaskAgentSessionRecordRef.current(id, recordId)
          }}
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
            selectNode={selectNode}
            closeNodeRef={closeNodeRef}
            resizeNodeRef={resizeNodeRef}
            saveAgentLastMessageToNoteRef={saveAgentLastMessageToNoteRef}
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
    updateNoteTextRef,
    openTaskEditorRef,
    quickUpdateTaskRequirementRef,
    quickUpdateTaskTitleRef,
    requestNodeDeleteRef,
    resizeNodeRef,
    runTaskAgentRef,
    saveAgentLastMessageToNoteRef,
    resumeTaskAgentSessionRef,
    removeTaskAgentSessionRecordRef,
    updateNodeScrollbackRef,
    updateTaskStatusRef,
    updateTerminalTitleRef,
    renameTerminalTitleRef,
  ])
}
