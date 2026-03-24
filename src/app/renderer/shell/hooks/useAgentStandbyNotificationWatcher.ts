import { useEffect, useRef } from 'react'
import type { TerminalSessionState, TerminalSessionStateEvent } from '@shared/contracts/dto'
import type { AgentRuntimeStatus } from '@contexts/agent/domain/types'
import { useAppStore } from '../store/useAppStore'
import { getPtyEventHub } from '../utils/ptyEventHub'

function normalizeSessionId(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') {
    return null
  }

  const trimmed = rawValue.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveAgentNodeForSessionId(sessionId: string): {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  nodeId: string
  title: string
  runtimeStatus: AgentRuntimeStatus | null
  executionDirectory: string
  taskId: string | null
} | null {
  const state = useAppStore.getState()

  for (const workspace of state.workspaces) {
    for (const node of workspace.nodes) {
      if (node.data.kind !== 'agent' || node.data.sessionId !== sessionId) {
        continue
      }

      const taskId = node.data.agent?.taskId ?? null
      const resolvedExecutionDirectory =
        node.data.executionDirectory ?? node.data.agent?.executionDirectory ?? workspace.path

      return {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspacePath: workspace.path,
        nodeId: node.id,
        title: node.data.title,
        runtimeStatus: node.data.status,
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
  const lastStateBySessionIdRef = useRef<Map<string, TerminalSessionState>>(new Map())
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
    const unsubscribe = ptyEventHub.onState((event: TerminalSessionStateEvent) => {
      const sessionId = normalizeSessionId(event.sessionId)
      if (!sessionId) {
        return
      }

      const previous = lastStateBySessionIdRef.current.get(sessionId) ?? null
      lastStateBySessionIdRef.current.set(sessionId, event.state)

      if (event.state === 'working') {
        workingHandlerRef.current(sessionId)
        return
      }

      const resolved = resolveAgentNodeForSessionId(sessionId)
      if (!resolved) {
        return
      }

      const inferredPrevious: TerminalSessionState | null =
        previous ??
        (resolved.runtimeStatus === 'running' || resolved.runtimeStatus === 'restoring'
          ? 'working'
          : resolved.runtimeStatus === 'standby'
            ? 'standby'
            : null)

      if (inferredPrevious !== 'working') {
        return
      }

      standbyHandlerRef.current({
        sessionId,
        workspaceId: resolved.workspaceId,
        workspaceName: resolved.workspaceName,
        workspacePath: resolved.workspacePath,
        nodeId: resolved.nodeId,
        title: resolved.title,
        executionDirectory: resolved.executionDirectory,
        taskId: resolved.taskId,
      })
    })

    return () => {
      unsubscribe()
    }
  }, [enabled])
}
