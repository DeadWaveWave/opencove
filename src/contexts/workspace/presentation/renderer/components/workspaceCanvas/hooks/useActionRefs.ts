import { useRef } from 'react'
import type { TaskRuntimeStatus } from '../../../types'

export interface WorkspaceCanvasActionRefs {
  runTaskAgentRef: React.MutableRefObject<(nodeId: string) => Promise<void>>
  resumeTaskAgentSessionRef: React.MutableRefObject<
    (taskNodeId: string, recordId: string) => Promise<void>
  >
  removeTaskAgentSessionRecordRef: React.MutableRefObject<
    (taskNodeId: string, recordId: string) => void
  >
  openTaskEditorRef: React.MutableRefObject<(nodeId: string) => void>
  quickUpdateTaskTitleRef: React.MutableRefObject<(nodeId: string, title: string) => void>
  quickUpdateTaskRequirementRef: React.MutableRefObject<
    (nodeId: string, requirement: string) => void
  >
  updateTaskStatusRef: React.MutableRefObject<(nodeId: string, status: TaskRuntimeStatus) => void>
}

export function useWorkspaceCanvasActionRefs(): WorkspaceCanvasActionRefs {
  const runTaskAgentRef = useRef<(nodeId: string) => Promise<void>>(
    async (_nodeId: string) => undefined,
  )
  const resumeTaskAgentSessionRef = useRef<(taskNodeId: string, recordId: string) => Promise<void>>(
    async (_taskNodeId: string, _recordId: string) => undefined,
  )
  const removeTaskAgentSessionRecordRef = useRef<(taskNodeId: string, recordId: string) => void>(
    (_taskNodeId: string, _recordId: string) => undefined,
  )
  const openTaskEditorRef = useRef<(nodeId: string) => void>(() => undefined)
  const quickUpdateTaskTitleRef = useRef<(nodeId: string, title: string) => void>(
    (_nodeId: string, _title: string) => undefined,
  )
  const quickUpdateTaskRequirementRef = useRef<(nodeId: string, requirement: string) => void>(
    (_nodeId: string, _requirement: string) => undefined,
  )
  const updateTaskStatusRef = useRef<(nodeId: string, status: TaskRuntimeStatus) => void>(
    (_nodeId: string, _status: TaskRuntimeStatus) => undefined,
  )
  return {
    runTaskAgentRef,
    resumeTaskAgentSessionRef,
    removeTaskAgentSessionRecordRef,
    openTaskEditorRef,
    quickUpdateTaskTitleRef,
    quickUpdateTaskRequirementRef,
    updateTaskStatusRef,
  }
}
