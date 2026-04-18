import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../types'

type WorkspaceCanvasAgentSessionState = {
  nodeId: string
  sessionId: string
  resumeSessionId: string | null
  status: string | null
}

type WorkspaceCanvasTestApi = {
  getAgentSessions: () => WorkspaceCanvasAgentSessionState[]
  getFirstAgentSessionId: () => string | null
  getResumeSessionIdByPtySessionId: (ptySessionId: string) => string | null
  getAgentStatusByPtySessionId: (ptySessionId: string) => string | null
  getSyncCount: () => number
  resetSyncCount: () => void
}

declare global {
  interface Window {
    __opencoveWorkspaceCanvasTestApi?: WorkspaceCanvasTestApi
  }
}

let agentSessions: WorkspaceCanvasAgentSessionState[] = []
let syncCount = 0

function getWorkspaceCanvasTestApi(): WorkspaceCanvasTestApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  if (!window.__opencoveWorkspaceCanvasTestApi) {
    window.__opencoveWorkspaceCanvasTestApi = {
      getAgentSessions: () => [...agentSessions],
      getFirstAgentSessionId: () => agentSessions[0]?.sessionId ?? null,
      getResumeSessionIdByPtySessionId: ptySessionId => {
        const normalizedSessionId = ptySessionId.trim()
        if (normalizedSessionId.length === 0) {
          return null
        }

        return (
          agentSessions.find(session => session.sessionId === normalizedSessionId)
            ?.resumeSessionId ?? null
        )
      },
      getAgentStatusByPtySessionId: ptySessionId => {
        const normalizedSessionId = ptySessionId.trim()
        if (normalizedSessionId.length === 0) {
          return null
        }

        return (
          agentSessions.find(session => session.sessionId === normalizedSessionId)?.status ?? null
        )
      },
      getSyncCount: () => syncCount,
      resetSyncCount: () => {
        syncCount = 0
      },
    }
  }

  return window.__opencoveWorkspaceCanvasTestApi
}

export function syncWorkspaceCanvasTestState(nodes: Node<TerminalNodeData>[]): void {
  if (typeof window === 'undefined') {
    return
  }

  getWorkspaceCanvasTestApi()
  syncCount += 1
  agentSessions = nodes.flatMap(node => {
    if (node.data.kind !== 'agent') {
      return []
    }

    const sessionId = node.data.sessionId.trim()
    if (sessionId.length === 0) {
      return []
    }

    const resumeSessionId =
      typeof node.data.agent?.resumeSessionId === 'string' &&
      node.data.agent.resumeSessionId.trim().length > 0
        ? node.data.agent.resumeSessionId
        : null

    return [
      {
        nodeId: node.id,
        sessionId,
        resumeSessionId,
        status: node.data.status,
      },
    ]
  })
}
