import { useEffect } from 'react'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { resolveObservedResumeSessionBindingUpdate } from '@contexts/agent/domain/agentResumeBinding'
import { truncateScrollback } from '@contexts/workspace/presentation/renderer/components/terminalNode/scrollback'
import { useScrollbackStore } from '@contexts/workspace/presentation/renderer/store/useScrollbackStore'
import { scheduleNodeScrollbackWrite } from '@contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule'
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
    updateNode,
  }: {
    sessionId: string
    updateNode: (node: Node<TerminalNodeData>) => Node<TerminalNodeData> | null
  },
): { nextWorkspaces: WorkspaceState[]; didChange: boolean } {
  let didChange = false

  const nextWorkspaces = workspaces.map(workspace => {
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

export function updateWorkspacesWithTerminalGeometry({
  workspaces,
  sessionId,
  cols,
  rows,
}: {
  workspaces: WorkspaceState[]
  sessionId: string
  cols: number
  rows: number
}): { nextWorkspaces: WorkspaceState[]; didChange: boolean } {
  let didChange = false

  const nextWorkspaces = workspaces.map(workspace => {
    let workspaceDidChange = false

    const nextNodes = workspace.nodes.map(node => {
      const nodeKind = node.data.kind
      if (
        (nodeKind !== 'terminal' && nodeKind !== 'agent') ||
        node.data.sessionId !== sessionId ||
        (node.data.terminalGeometry?.cols === cols && node.data.terminalGeometry.rows === rows)
      ) {
        return node
      }

      workspaceDidChange = true
      return {
        ...node,
        data: {
          ...node.data,
          terminalGeometry: { cols, rows },
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

export function updateWorkspacesWithAgentExit({
  workspaces,
  sessionId,
  exitCode,
  now,
}: {
  workspaces: WorkspaceState[]
  sessionId: string
  exitCode: number
  now: string
}): { nextWorkspaces: WorkspaceState[]; didChange: boolean } {
  let didChange = false

  const nextWorkspaces = workspaces.map(workspace => {
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

export function updateWorkspacesWithAgentMetadata({
  workspaces,
  sessionId,
  resumeSessionId,
}: {
  workspaces: WorkspaceState[]
  sessionId: string
  resumeSessionId: string | null | undefined
}): { nextWorkspaces: WorkspaceState[]; didChange: boolean } {
  let didChange = false

  const nextWorkspaces = workspaces.map(workspace => {
    let workspaceDidChange = false

    const nextNodes = workspace.nodes.map(node => {
      if (node.data.kind !== 'agent' || node.data.sessionId !== sessionId || !node.data.agent) {
        return node
      }

      const update = resolveObservedResumeSessionBindingUpdate(node.data.agent, resumeSessionId)
      if (!update) {
        return node
      }

      workspaceDidChange = true
      return {
        ...node,
        data: {
          ...node.data,
          agent: {
            ...node.data.agent,
            ...update,
          },
        },
      }
    })

    if (!workspaceDidChange) {
      return workspace
    }

    didChange = true
    return { ...workspace, nodes: nextNodes }
  })

  return { nextWorkspaces: didChange ? nextWorkspaces : workspaces, didChange }
}

export function resolveInactiveTerminalNodeForSession({
  workspaces,
  activeWorkspaceId,
  sessionId,
}: {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
  sessionId: string
}): { nodeId: string; scrollback: string | null } | null {
  const normalizedSessionId = sessionId.trim()
  if (normalizedSessionId.length === 0) {
    return null
  }

  for (const workspace of workspaces) {
    if (workspace.id === activeWorkspaceId) {
      continue
    }

    const node = workspace.nodes.find(
      candidate =>
        candidate.data.kind === 'terminal' && candidate.data.sessionId === normalizedSessionId,
    )
    if (node?.data.kind !== 'terminal') {
      continue
    }

    return {
      nodeId: node.id,
      scrollback: node.data.scrollback,
    }
  }

  return null
}

export function appendInactiveTerminalScrollback({
  nodeId,
  baseScrollback,
  chunk,
}: {
  nodeId: string
  baseScrollback: string | null
  chunk: string
}): void {
  if (chunk.length === 0) {
    return
  }

  const currentScrollback =
    useScrollbackStore.getState().scrollbackByNodeId[nodeId] ?? baseScrollback ?? ''
  const nextScrollback = truncateScrollback(`${currentScrollback}${chunk}`)

  useScrollbackStore.getState().setNodeScrollback(nodeId, nextScrollback)
  scheduleNodeScrollbackWrite(nodeId, nextScrollback)
}

export function usePtyWorkspaceRuntimeSync({
  requestPersistFlush,
}: {
  requestPersistFlush: () => void
}): void {
  const setWorkspaces = useAppStore(state => state.setWorkspaces)

  useEffect(() => {
    const ptyEventHub = getPtyEventHub()

    const appendInactiveTerminalChunk = (sessionId: string, chunk: string): void => {
      const { workspaces, activeWorkspaceId } = useAppStore.getState()
      const target = resolveInactiveTerminalNodeForSession({
        workspaces,
        activeWorkspaceId,
        sessionId,
      })
      if (!target) {
        return
      }

      appendInactiveTerminalScrollback({
        nodeId: target.nodeId,
        baseScrollback: target.scrollback,
        chunk,
      })
    }

    const unsubscribeData = ptyEventHub.onData(event => {
      appendInactiveTerminalChunk(event.sessionId, event.data)
    })

    const unsubscribeState = ptyEventHub.onState(event => {
      let didChange = false

      setWorkspaces(previous => {
        const result = updateWorkspacesWithAgentNodes(previous, {
          sessionId: event.sessionId,
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
      let didChange = false

      setWorkspaces(previous => {
        const result = updateWorkspacesWithAgentMetadata({
          workspaces: previous,
          sessionId: event.sessionId,
          resumeSessionId: normalizeResumeSessionId(event.resumeSessionId),
        })

        didChange = result.didChange
        return didChange ? result.nextWorkspaces : previous
      })

      if (didChange) {
        requestPersistFlush()
      }
    })

    const unsubscribeGeometry = ptyEventHub.onGeometry(event => {
      let didChange = false

      setWorkspaces(previous => {
        const result = updateWorkspacesWithTerminalGeometry({
          workspaces: previous,
          sessionId: event.sessionId,
          cols: event.cols,
          rows: event.rows,
        })

        didChange = result.didChange
        return didChange ? result.nextWorkspaces : previous
      })

      if (didChange) {
        requestPersistFlush()
      }
    })

    const unsubscribeExit = ptyEventHub.onExit(event => {
      appendInactiveTerminalChunk(
        event.sessionId,
        `\r\n[process exited with code ${event.exitCode}]\r\n`,
      )

      let didChange = false
      const now = new Date().toISOString()

      setWorkspaces(previous => {
        const result = updateWorkspacesWithAgentExit({
          workspaces: previous,
          sessionId: event.sessionId,
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
      unsubscribeData()
      unsubscribeState()
      unsubscribeMetadata()
      unsubscribeGeometry()
      unsubscribeExit()
    }
  }, [requestPersistFlush, setWorkspaces])
}
