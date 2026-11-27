import { useRef } from 'react'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { TaskRuntimeStatus } from '../../../types'

export interface WorkspaceCanvasActionRefs {
  updateRoleInputRef: React.MutableRefObject<(nodeId: string, input: string) => void>
  updateRoleProviderRef: React.MutableRefObject<(nodeId: string, provider: AgentProvider) => void>
  runRoleRef: React.MutableRefObject<(nodeId: string, inputOverride?: string) => Promise<void>>
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
  const updateRoleInputRef = useRef<(nodeId: string, input: string) => void>(
    (_nodeId: string, _input: string) => undefined,
  )
  const updateRoleProviderRef = useRef<(nodeId: string, provider: AgentProvider) => void>(
    (_nodeId: string, _provider: AgentProvider) => undefined,
  )
  const runRoleRef = useRef<(nodeId: string, inputOverride?: string) => Promise<void>>(
    async (_nodeId: string, _inputOverride?: string) => undefined,
  )
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
    updateRoleInputRef,
    updateRoleProviderRef,
    runRoleRef,
    runTaskAgentRef,
    resumeTaskAgentSessionRef,
    removeTaskAgentSessionRecordRef,
    openTaskEditorRef,
    quickUpdateTaskTitleRef,
    quickUpdateTaskRequirementRef,
    updateTaskStatusRef,
  }
}
