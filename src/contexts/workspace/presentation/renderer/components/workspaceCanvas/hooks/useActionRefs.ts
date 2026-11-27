import { useLayoutEffect, useRef } from 'react'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { TaskRuntimeStatus } from '../../../types'
import type { AgentSessionSummary } from '@shared/contracts/dto'

export interface WorkspaceCanvasActionRefs {
  copyAgentLastMessageRef: React.MutableRefObject<(nodeId: string) => Promise<void>>
  reloadAgentSessionRef: React.MutableRefObject<(nodeId: string) => Promise<void>>
  listAgentSessionsRef: React.MutableRefObject<
    (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>
  >
  switchAgentSessionRef: React.MutableRefObject<
    (nodeId: string, summary: AgentSessionSummary) => Promise<void>
  >
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
  updateNodeScrollbackRef: React.MutableRefObject<(nodeId: string, scrollback: string) => void>
  updateTerminalTitleRef: React.MutableRefObject<
    (nodeId: string, title: string, startedAtMs?: number) => void
  >
  clearTerminalAgentOverlayRef: React.MutableRefObject<
    (nodeId: string, expectedStartedAtMs?: number) => void
  >
  renameTerminalTitleRef: React.MutableRefObject<(nodeId: string, title: string) => void>
}

export function useWorkspaceCanvasActionRefs(): WorkspaceCanvasActionRefs {
  const copyAgentLastMessageRef = useRef<(nodeId: string) => Promise<void>>(
    async (_nodeId: string) => undefined,
  )
  const reloadAgentSessionRef = useRef<(nodeId: string) => Promise<void>>(
    async (_nodeId: string) => undefined,
  )
  const listAgentSessionsRef = useRef<
    (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>
  >(async (_nodeId: string, _limit?: number) => [])
  const switchAgentSessionRef = useRef<
    (nodeId: string, summary: AgentSessionSummary) => Promise<void>
  >(async (_nodeId: string, _summary: AgentSessionSummary) => undefined)
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
  const updateNodeScrollbackRef = useRef<(nodeId: string, scrollback: string) => void>(
    (_nodeId: string, _scrollback: string) => undefined,
  )
  const updateTerminalTitleRef = useRef<
    (nodeId: string, title: string, startedAtMs?: number) => void
  >((_nodeId: string, _title: string, _startedAtMs?: number) => undefined)
  const clearTerminalAgentOverlayRef = useRef<
    (nodeId: string, expectedStartedAtMs?: number) => void
  >(() => undefined)
  const renameTerminalTitleRef = useRef<(nodeId: string, title: string) => void>(
    (_nodeId: string, _title: string) => undefined,
  )
  return {
    copyAgentLastMessageRef,
    reloadAgentSessionRef,
    listAgentSessionsRef,
    switchAgentSessionRef,
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
    updateNodeScrollbackRef,
    updateTerminalTitleRef,
    clearTerminalAgentOverlayRef,
    renameTerminalTitleRef,
  }
}

interface SyncActionRefsParams {
  actionRefs: WorkspaceCanvasActionRefs
  copyAgentLastMessage: (nodeId: string) => Promise<void>
  reloadAgentSession: (nodeId: string) => Promise<void>
  listAgentSessions: (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>
  switchAgentSession: (nodeId: string, summary: AgentSessionSummary) => Promise<void>
  updateNodeScrollback: (nodeId: string, scrollback: string) => void
  updateTerminalTitle: (nodeId: string, title: string, startedAtMs?: number) => void
  clearTerminalAgentOverlay: (nodeId: string, expectedStartedAtMs?: number) => void
  renameTerminalTitle: (nodeId: string, title: string) => void
}

export function useWorkspaceCanvasSyncActionRefs({
  actionRefs,
  copyAgentLastMessage,
  reloadAgentSession,
  listAgentSessions,
  switchAgentSession,
  updateNodeScrollback,
  updateTerminalTitle,
  clearTerminalAgentOverlay,
  renameTerminalTitle,
}: SyncActionRefsParams): void {
  useLayoutEffect(() => {
    actionRefs.copyAgentLastMessageRef.current = copyAgentLastMessage
  }, [actionRefs.copyAgentLastMessageRef, copyAgentLastMessage])

  useLayoutEffect(() => {
    actionRefs.reloadAgentSessionRef.current = reloadAgentSession
  }, [actionRefs.reloadAgentSessionRef, reloadAgentSession])

  useLayoutEffect(() => {
    actionRefs.listAgentSessionsRef.current = listAgentSessions
  }, [actionRefs.listAgentSessionsRef, listAgentSessions])

  useLayoutEffect(() => {
    actionRefs.switchAgentSessionRef.current = switchAgentSession
  }, [actionRefs.switchAgentSessionRef, switchAgentSession])

  useLayoutEffect(() => {
    actionRefs.updateNodeScrollbackRef.current = (nodeId, scrollback) => {
      updateNodeScrollback(nodeId, scrollback)
    }
  }, [actionRefs.updateNodeScrollbackRef, updateNodeScrollback])

  useLayoutEffect(() => {
    actionRefs.updateTerminalTitleRef.current = (nodeId, title, startedAtMs) => {
      updateTerminalTitle(nodeId, title, startedAtMs)
    }
  }, [actionRefs.updateTerminalTitleRef, updateTerminalTitle])

  useLayoutEffect(() => {
    actionRefs.clearTerminalAgentOverlayRef.current = clearTerminalAgentOverlay
  }, [actionRefs.clearTerminalAgentOverlayRef, clearTerminalAgentOverlay])

  useLayoutEffect(() => {
    actionRefs.renameTerminalTitleRef.current = (nodeId, title) => {
      renameTerminalTitle(nodeId, title)
    }
  }, [actionRefs.renameTerminalTitleRef, renameTerminalTitle])
}
