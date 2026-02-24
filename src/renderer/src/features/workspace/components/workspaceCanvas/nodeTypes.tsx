import { useMemo, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { TaskNode } from '../TaskNode'
import { TerminalNode } from '../TerminalNode'
import type { Size, TerminalNodeData } from '../../types'
import type {
  QuickUpdateTaskRequirement,
  QuickUpdateTaskTitle,
  UpdateNodeScrollback,
  UpdateTaskStatus,
} from './types'

interface WorkspaceCanvasNodeTypesParams {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredSize: Size) => void>
  updateNodeScrollbackRef: MutableRefObject<UpdateNodeScrollback>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
  stopAgentNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  rerunAgentNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resumeAgentNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  requestTaskDeleteRef: MutableRefObject<(nodeId: string) => void>
  openTaskEditorRef: MutableRefObject<(nodeId: string) => void>
  quickUpdateTaskTitleRef: MutableRefObject<QuickUpdateTaskTitle>
  quickUpdateTaskRequirementRef: MutableRefObject<QuickUpdateTaskRequirement>
  openTaskAssignerRef: MutableRefObject<(nodeId: string) => void>
  runTaskAgentRef: MutableRefObject<(nodeId: string) => Promise<void>>
  updateTaskStatusRef: MutableRefObject<UpdateTaskStatus>
  updateTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  renameTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
}

export function useWorkspaceCanvasNodeTypes({
  nodesRef,
  closeNodeRef,
  resizeNodeRef,
  updateNodeScrollbackRef,
  normalizeViewportForTerminalInteractionRef,
  stopAgentNodeRef,
  rerunAgentNodeRef,
  resumeAgentNodeRef,
  requestTaskDeleteRef,
  openTaskEditorRef,
  quickUpdateTaskTitleRef,
  quickUpdateTaskRequirementRef,
  openTaskAssignerRef,
  runTaskAgentRef,
  updateTaskStatusRef,
  updateTerminalTitleRef,
  renameTerminalTitleRef,
}: WorkspaceCanvasNodeTypesParams): Record<
  string,
  (props: { data: TerminalNodeData; id: string }) => JSX.Element | null
> {
  return useMemo(
    () => ({
      terminalNode: ({ data, id }: { data: TerminalNodeData; id: string }) => (
        <TerminalNode
          sessionId={data.sessionId}
          title={data.title}
          kind={data.kind}
          status={data.status}
          lastError={data.lastError}
          width={data.width}
          height={data.height}
          scrollback={data.scrollback}
          onClose={() => {
            void closeNodeRef.current(id)
          }}
          onResize={size => resizeNodeRef.current(id, size)}
          onScrollbackChange={scrollback => updateNodeScrollbackRef.current(id, scrollback)}
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
          onInteractionStart={() => normalizeViewportForTerminalInteractionRef.current(id)}
          onStop={
            data.kind === 'agent'
              ? () => {
                  void stopAgentNodeRef.current(id)
                }
              : undefined
          }
          onRerun={
            data.kind === 'agent'
              ? () => {
                  void rerunAgentNodeRef.current(id)
                }
              : undefined
          }
          onResume={
            data.kind === 'agent'
              ? () => {
                  void resumeAgentNodeRef.current(id)
                }
              : undefined
          }
        />
      ),
      taskNode: ({ data, id }: { data: TerminalNodeData; id: string }) => {
        if (!data.task) {
          return null
        }

        const linkedAgentTitle = data.task.linkedAgentNodeId
          ? (nodesRef.current.find(
              node => node.id === data.task?.linkedAgentNodeId && node.data.kind === 'agent',
            )?.data.title ?? null)
          : null

        return (
          <TaskNode
            title={data.title}
            requirement={data.task.requirement}
            status={data.task.status}
            priority={data.task.priority}
            tags={data.task.tags}
            createdAt={data.task.createdAt}
            updatedAt={data.task.updatedAt}
            linkedAgentTitle={linkedAgentTitle}
            width={data.width}
            height={data.height}
            onClose={() => {
              requestTaskDeleteRef.current(id)
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
            onAssignAgent={() => {
              openTaskAssignerRef.current(id)
            }}
            onRunAgent={() => {
              void runTaskAgentRef.current(id)
            }}
            onResize={size => resizeNodeRef.current(id, size)}
            onStatusChange={status => {
              updateTaskStatusRef.current(id, status)
            }}
          />
        )
      },
    }),
    [
      closeNodeRef,
      normalizeViewportForTerminalInteractionRef,
      nodesRef,
      openTaskAssignerRef,
      openTaskEditorRef,
      quickUpdateTaskRequirementRef,
      quickUpdateTaskTitleRef,
      requestTaskDeleteRef,
      rerunAgentNodeRef,
      resizeNodeRef,
      resumeAgentNodeRef,
      runTaskAgentRef,
      stopAgentNodeRef,
      updateNodeScrollbackRef,
      updateTaskStatusRef,
      updateTerminalTitleRef,
      renameTerminalTitleRef,
    ],
  )
}
