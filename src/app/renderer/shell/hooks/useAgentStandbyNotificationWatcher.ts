import { useEffect, useRef } from 'react'
import { isAgentNodeAwaitingSessionTitle } from '@contexts/workspace/presentation/renderer/utils/agentSessionTitleSync'
import { resolveAgentPresentation } from '@contexts/workspace/presentation/renderer/utils/agentPresentation'
import { useAppStore } from '../store/useAppStore'
import { getPtyEventHub } from '../utils/ptyEventHub'
import { AgentCompletionTracker } from '../utils/agentCompletionTracker'

function normalizeSessionId(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') {
    return null
  }

  const trimmed = rawValue.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function resolveAgentNodeForSessionId(sessionId: string): {
  sessionId: string
  workspaceId: string
  workspaceName: string
  workspacePath: string
  nodeId: string
  title: string
  awaitingSessionTitle: boolean
  executionDirectory: string
  taskId: string | null
} | null {
  const state = useAppStore.getState()

  for (const workspace of state.workspaces) {
    for (const node of workspace.nodes) {
      if (node.data.sessionId !== sessionId) {
        continue
      }
      const presentation = resolveAgentPresentation(node.data)
      if (!presentation.isAgent) {
        continue
      }

      const taskId = node.data.agent?.taskId ?? null
      const agent = node.data.agent
      const resolvedExecutionDirectory =
        node.data.executionDirectory ?? agent?.executionDirectory ?? workspace.path

      return {
        sessionId,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspacePath: workspace.path,
        nodeId: node.id,
        title: node.data.title,
        awaitingSessionTitle: isAgentNodeAwaitingSessionTitle(node),
        executionDirectory: resolvedExecutionDirectory,
        taskId,
      }
    }
  }

  return null
}

export type AgentStandbyNotificationPayload = {
  sessionId: string
  workspaceId: string
  workspaceName: string
  workspacePath: string
  nodeId: string
  title: string
  awaitingSessionTitle: boolean
  executionDirectory: string
  taskId: string | null
}

export function useAgentStandbyNotificationWatcher({
  enabled = true,
  onAgentEnteredStandby,
  onAgentEnteredWorking,
}: {
  enabled?: boolean
  onAgentEnteredStandby: (payload: AgentStandbyNotificationPayload) => void
  onAgentEnteredWorking: (sessionId: string) => void
}): void {
  const completionsRef = useRef<AgentCompletionTracker | null>(null)
  completionsRef.current ??= new AgentCompletionTracker(Date.now())
  const standbyHandlerRef = useRef(onAgentEnteredStandby)
  const workingHandlerRef = useRef(onAgentEnteredWorking)

  useEffect(() => {
    standbyHandlerRef.current = onAgentEnteredStandby
  }, [onAgentEnteredStandby])

  useEffect(() => {
    workingHandlerRef.current = onAgentEnteredWorking
  }, [onAgentEnteredWorking])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const ptyEventHub = getPtyEventHub()
    const completions = completionsRef.current!
    const unsubscribeExit = ptyEventHub.onExit(event => completions.forget(event.sessionId))
    const unsubscribe = ptyEventHub.onState((event, delivery) => {
      const sessionId = normalizeSessionId(event.sessionId)
      if (!sessionId) {
        return
      }

      const snapshot = event.agentRunState
      if (!snapshot) {
        return
      }
      const completed = completions.consume(snapshot, delivery?.replay === true)
      if (snapshot.state === 'working' && delivery?.replay !== true) {
        workingHandlerRef.current(sessionId)
        return
      }

      if (!completed) {
        return
      }

      const resolved = resolveAgentNodeForSessionId(sessionId)
      if (!resolved) {
        return
      }

      standbyHandlerRef.current({
        sessionId,
        workspaceId: resolved.workspaceId,
        workspaceName: resolved.workspaceName,
        workspacePath: resolved.workspacePath,
        nodeId: resolved.nodeId,
        title: resolved.title,
        awaitingSessionTitle: resolved.awaitingSessionTitle,
        executionDirectory: resolved.executionDirectory,
        taskId: resolved.taskId,
      })
    })

    return () => {
      unsubscribe()
      unsubscribeExit()
    }
  }, [enabled])
}
