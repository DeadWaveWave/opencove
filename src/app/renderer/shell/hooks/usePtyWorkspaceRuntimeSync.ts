import { useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { getPtyEventHub } from '../utils/ptyEventHub'
import { useAppStore } from '../store/useAppStore'

function shouldIgnoreAgentStatusUpdate(status: TerminalNodeData['status']): boolean {
  return status === 'failed' || status === 'stopped' || status === 'exited'
}

function normalizeResumeSessionId(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') {
    return null
  }

  const trimmed = rawValue.trim()
  return trimmed.length > 0 ? trimmed : null
}

function updateWorkspacesWithAgentNodes(
  workspaces: WorkspaceState[],
  {
    sessionId,
    excludeWorkspaceId,
    updateNode,
  }: {
    sessionId: string
    excludeWorkspaceId: string | null
    updateNode: (node: Node<TerminalNodeData>) => Node<TerminalNodeData> | null
  },
): { nextWorkspaces: WorkspaceState[]; didChange: boolean } {
  let didChange = false

  const nextWorkspaces = workspaces.map(workspace => {
    if (excludeWorkspaceId && workspace.id === excludeWorkspaceId) {
      return workspace
    }

    let workspaceDidChange = false

    const nextNodes = workspace.nodes.map(node => {
      if (node.data.kind !== 'agent' || node.data.sessionId !== sessionId) {
        return node
      }

      const updated = updateNode(node)
      if (!updated) {
        return node
      }

      workspaceDidChange = true
      return updated
    })

    if (!workspaceDidChange) {
      return workspace
    }

    didChange = true
    return { ...workspace, nodes: nextNodes }
  })

  return { nextWorkspaces, didChange }
}

export function updateWorkspacesWithAgentExit({
  workspaces,
  sessionId,
  excludeWorkspaceId,
  exitCode,
  now,
}: {
  workspaces: WorkspaceState[]
  sessionId: string
  excludeWorkspaceId: string | null
  exitCode: number
  now: string
}): { nextWorkspaces: WorkspaceState[]; didChange: boolean } {
  let didChange = false

  const nextWorkspaces = workspaces.map(workspace => {
    if (excludeWorkspaceId && workspace.id === excludeWorkspaceId) {
      return workspace
    }

    let workspaceDidChange = false

    const nextNodes = workspace.nodes.map(node => {
      if (node.data.kind !== 'agent' || node.data.sessionId !== sessionId) {
        return node
      }

      if (node.data.status === 'stopped') {
        return node
      }

      workspaceDidChange = true

      return {
        ...node,
        data: {
          ...node.data,
          status: exitCode === 0 ? ('exited' as const) : ('failed' as const),
          endedAt: now,
          exitCode,
        },
      }
    })

    if (!workspaceDidChange) {
      return workspace
    }

    didChange = true
    return { ...workspace, nodes: nextNodes }
  })

  return { nextWorkspaces, didChange }
}

export function usePtyWorkspaceRuntimeSync({
  requestPersistFlush,
}: {
  requestPersistFlush: () => void
}): void {
  const setWorkspaces = useAppStore(state => state.setWorkspaces)
  const activeWorkspaceId = useAppStore(state => state.activeWorkspaceId)
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  useEffect(() => {
    const ptyEventHub = getPtyEventHub()

    const unsubscribeState = ptyEventHub.onState(event => {
      let didChange = false

      setWorkspaces(previous => {
        const excludeWorkspaceId = activeWorkspaceIdRef.current
        const result = updateWorkspacesWithAgentNodes(previous, {
          sessionId: event.sessionId,
          excludeWorkspaceId,
          updateNode: node => {
            if (shouldIgnoreAgentStatusUpdate(node.data.status)) {
              return null
            }

            const nextStatus = event.state === 'standby' ? 'standby' : 'running'
            if (node.data.status === nextStatus) {
              return null
            }

            return { ...node, data: { ...node.data, status: nextStatus } }
          },
        })

        didChange = result.didChange
        return didChange ? result.nextWorkspaces : previous
      })

      if (didChange) {
        requestPersistFlush()
      }
    })

    const unsubscribeMetadata = ptyEventHub.onMetadata(event => {
      const nextResumeSessionId = normalizeResumeSessionId(event.resumeSessionId)
      if (!nextResumeSessionId) {
        return
      }

      let didChange = false

      setWorkspaces(previous => {
        const excludeWorkspaceId = activeWorkspaceIdRef.current
        const result = updateWorkspacesWithAgentNodes(previous, {
          sessionId: event.sessionId,
          excludeWorkspaceId,
          updateNode: node => {
            if (!node.data.agent) {
              return null
            }

            const nextVerified = true
            if (
              node.data.agent.resumeSessionId === nextResumeSessionId &&
              node.data.agent.resumeSessionIdVerified === nextVerified
            ) {
              return null
            }

            return {
              ...node,
              data: {
                ...node.data,
                agent: {
                  ...node.data.agent,
                  resumeSessionId: nextResumeSessionId,
                  resumeSessionIdVerified: nextVerified,
                },
              },
            }
          },
        })

        didChange = result.didChange
        return didChange ? result.nextWorkspaces : previous
      })

      if (didChange) {
        requestPersistFlush()
      }
    })

    const unsubscribeExit = ptyEventHub.onExit(event => {
      let didChange = false
      const now = new Date().toISOString()

      setWorkspaces(previous => {
        const excludeWorkspaceId = activeWorkspaceIdRef.current
        const result = updateWorkspacesWithAgentExit({
          workspaces: previous,
          sessionId: event.sessionId,
          excludeWorkspaceId,
          exitCode: event.exitCode,
          now,
        })

        didChange = result.didChange
        return didChange ? result.nextWorkspaces : previous
      })

      if (didChange) {
        requestPersistFlush()
      }
    })

    return () => {
      unsubscribeState()
      unsubscribeMetadata()
      unsubscribeExit()
    }
  }, [requestPersistFlush, setWorkspaces])
}
