import { useLayoutEffect, useRef } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { NodeFrame, TaskRuntimeStatus, TerminalNodeData } from '../../../types'
import { focusNodeInViewport } from '../helpers'
import type { AgentSessionSummary, WebsiteWindowSessionMode } from '@shared/contracts/dto'

export interface WorkspaceCanvasActionRefs {
  clearNodeSelectionRef: React.MutableRefObject<() => void>
  closeNodeRef: React.MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: React.MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  copyAgentLastMessageRef: React.MutableRefObject<(nodeId: string) => Promise<void>>
  reloadAgentSessionRef: React.MutableRefObject<(nodeId: string) => Promise<void>>
  listAgentSessionsRef: React.MutableRefObject<
    (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>
  >
  switchAgentSessionRef: React.MutableRefObject<
    (nodeId: string, summary: AgentSessionSummary) => Promise<void>
  >
  updateNoteTextRef: React.MutableRefObject<(nodeId: string, text: string) => void>
  renameNoteTitleRef: React.MutableRefObject<(nodeId: string, title: string) => void>
  updateWebsiteUrlRef: React.MutableRefObject<(nodeId: string, url: string) => void>
  setWebsitePinnedRef: React.MutableRefObject<(nodeId: string, pinned: boolean) => void>
  setWebsiteSessionRef: React.MutableRefObject<
    (nodeId: string, sessionMode: WebsiteWindowSessionMode, profileId: string | null) => void
  >
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
  requestNodeDeleteRef: React.MutableRefObject<(nodeIds: string[]) => void>
  updateTaskStatusRef: React.MutableRefObject<(nodeId: string, status: TaskRuntimeStatus) => void>
  updateNodeScrollbackRef: React.MutableRefObject<(nodeId: string, scrollback: string) => void>
  updateTerminalTitleRef: React.MutableRefObject<(nodeId: string, title: string) => void>
  renameTerminalTitleRef: React.MutableRefObject<(nodeId: string, title: string) => void>
  normalizeViewportForTerminalInteractionRef: React.MutableRefObject<(nodeId: string) => void>
}

export function useWorkspaceCanvasActionRefs(): WorkspaceCanvasActionRefs {
  const clearNodeSelectionRef = useRef<() => void>(() => undefined)
  const closeNodeRef = useRef<(nodeId: string) => Promise<void>>(
    async (_nodeId: string) => undefined,
  )
  const resizeNodeRef = useRef<(nodeId: string, desiredFrame: NodeFrame) => void>(
    (_nodeId: string, _desiredFrame: NodeFrame) => undefined,
  )
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
  const updateNoteTextRef = useRef<(nodeId: string, text: string) => void>(
    (_nodeId: string, _text: string) => undefined,
  )
  const renameNoteTitleRef = useRef<(nodeId: string, title: string) => void>(
    (_nodeId: string, _title: string) => undefined,
  )
  const updateWebsiteUrlRef = useRef<(nodeId: string, url: string) => void>(
    (_nodeId: string, _url: string) => undefined,
  )
  const setWebsitePinnedRef = useRef<(nodeId: string, pinned: boolean) => void>(
    (_nodeId: string, _pinned: boolean) => undefined,
  )
  const setWebsiteSessionRef = useRef<
    (nodeId: string, sessionMode: WebsiteWindowSessionMode, profileId: string | null) => void
  >(
    (_nodeId: string, _sessionMode: WebsiteWindowSessionMode, _profileId: string | null) =>
      undefined,
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
  const requestNodeDeleteRef = useRef<(nodeIds: string[]) => void>(() => undefined)
  const updateTaskStatusRef = useRef<(nodeId: string, status: TaskRuntimeStatus) => void>(
    (_nodeId: string, _status: TaskRuntimeStatus) => undefined,
  )
  const updateNodeScrollbackRef = useRef<(nodeId: string, scrollback: string) => void>(
    (_nodeId: string, _scrollback: string) => undefined,
  )
  const updateTerminalTitleRef = useRef<(nodeId: string, title: string) => void>(
    (_nodeId: string, _title: string) => undefined,
  )
  const renameTerminalTitleRef = useRef<(nodeId: string, title: string) => void>(
    (_nodeId: string, _title: string) => undefined,
  )
  const normalizeViewportForTerminalInteractionRef = useRef<(nodeId: string) => void>(
    (_nodeId: string) => undefined,
  )

  return {
    clearNodeSelectionRef,
    closeNodeRef,
    resizeNodeRef,
    copyAgentLastMessageRef,
    reloadAgentSessionRef,
    listAgentSessionsRef,
    switchAgentSessionRef,
    updateNoteTextRef,
    renameNoteTitleRef,
    updateWebsiteUrlRef,
    setWebsitePinnedRef,
    setWebsiteSessionRef,
    runTaskAgentRef,
    resumeTaskAgentSessionRef,
    removeTaskAgentSessionRecordRef,
    openTaskEditorRef,
    quickUpdateTaskTitleRef,
    quickUpdateTaskRequirementRef,
    requestNodeDeleteRef,
    updateTaskStatusRef,
    updateNodeScrollbackRef,
    updateTerminalTitleRef,
    renameTerminalTitleRef,
    normalizeViewportForTerminalInteractionRef,
  }
}

interface SyncActionRefsParams {
  actionRefs: WorkspaceCanvasActionRefs
  clearNodeSelection: () => void
  closeNode: (nodeId: string) => Promise<void>
  resizeNode: (nodeId: string, desiredFrame: NodeFrame) => void
  copyAgentLastMessage: (nodeId: string) => Promise<void>
  reloadAgentSession: (nodeId: string) => Promise<void>
  listAgentSessions: (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>
  switchAgentSession: (nodeId: string, summary: AgentSessionSummary) => Promise<void>
  updateNoteText: (nodeId: string, text: string) => void
  renameNoteTitle: (nodeId: string, title: string) => void
  updateWebsiteUrl: (nodeId: string, url: string) => void
  setWebsitePinned: (nodeId: string, pinned: boolean) => void
  setWebsiteSession: (
    nodeId: string,
    sessionMode: WebsiteWindowSessionMode,
    profileId: string | null,
  ) => void
  updateNodeScrollback: (nodeId: string, scrollback: string) => void
  updateTerminalTitle: (nodeId: string, title: string) => void
  renameTerminalTitle: (nodeId: string, title: string) => void
  focusNodeOnClick: boolean
  focusNodeTargetZoom: number
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
}

export function useWorkspaceCanvasSyncActionRefs({
  actionRefs,
  clearNodeSelection,
  closeNode,
  resizeNode,
  copyAgentLastMessage,
  reloadAgentSession,
  listAgentSessions,
  switchAgentSession,
  updateNoteText,
  renameNoteTitle,
  updateWebsiteUrl,
  setWebsitePinned,
  setWebsiteSession,
  updateNodeScrollback,
  updateTerminalTitle,
  renameTerminalTitle,
  focusNodeOnClick,
  focusNodeTargetZoom,
  nodesRef,
  reactFlow,
}: SyncActionRefsParams): void {
  useLayoutEffect(() => {
    actionRefs.clearNodeSelectionRef.current = clearNodeSelection
  }, [actionRefs.clearNodeSelectionRef, clearNodeSelection])

  useLayoutEffect(() => {
    actionRefs.closeNodeRef.current = closeNode
  }, [actionRefs.closeNodeRef, closeNode])

  useLayoutEffect(() => {
    actionRefs.resizeNodeRef.current = resizeNode
  }, [actionRefs.resizeNodeRef, resizeNode])

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
    actionRefs.updateNoteTextRef.current = (nodeId, text) => {
      updateNoteText(nodeId, text)
    }
  }, [actionRefs.updateNoteTextRef, updateNoteText])

  useLayoutEffect(() => {
    actionRefs.renameNoteTitleRef.current = (nodeId, title) => {
      renameNoteTitle(nodeId, title)
    }
  }, [actionRefs.renameNoteTitleRef, renameNoteTitle])

  useLayoutEffect(() => {
    actionRefs.updateWebsiteUrlRef.current = (nodeId, url) => {
      updateWebsiteUrl(nodeId, url)
    }
  }, [actionRefs.updateWebsiteUrlRef, updateWebsiteUrl])

  useLayoutEffect(() => {
    actionRefs.setWebsitePinnedRef.current = (nodeId, pinned) => {
      setWebsitePinned(nodeId, pinned)
    }
  }, [actionRefs.setWebsitePinnedRef, setWebsitePinned])

  useLayoutEffect(() => {
    actionRefs.setWebsiteSessionRef.current = (nodeId, sessionMode, profileId) => {
      setWebsiteSession(nodeId, sessionMode, profileId)
    }
  }, [actionRefs.setWebsiteSessionRef, setWebsiteSession])

  useLayoutEffect(() => {
    actionRefs.updateNodeScrollbackRef.current = (nodeId, scrollback) => {
      updateNodeScrollback(nodeId, scrollback)
    }
  }, [actionRefs.updateNodeScrollbackRef, updateNodeScrollback])

  useLayoutEffect(() => {
    actionRefs.updateTerminalTitleRef.current = (nodeId, title) => {
      updateTerminalTitle(nodeId, title)
    }
  }, [actionRefs.updateTerminalTitleRef, updateTerminalTitle])

  useLayoutEffect(() => {
    actionRefs.renameTerminalTitleRef.current = (nodeId, title) => {
      renameTerminalTitle(nodeId, title)
    }
  }, [actionRefs.renameTerminalTitleRef, renameTerminalTitle])

  useLayoutEffect(() => {
    actionRefs.normalizeViewportForTerminalInteractionRef.current = (nodeId: string) => {
      if (!focusNodeOnClick) {
        return
      }

      const targetNode = nodesRef.current.find(node => node.id === nodeId)
      if (!targetNode) {
        return
      }

      focusNodeInViewport(reactFlow, targetNode, { duration: 120, zoom: focusNodeTargetZoom })
    }
  }, [
    actionRefs.normalizeViewportForTerminalInteractionRef,
    focusNodeOnClick,
    focusNodeTargetZoom,
    nodesRef,
    reactFlow,
  ])
}
