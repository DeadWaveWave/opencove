import { useEffect } from 'react'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { AgentHookInstallState, TerminalSessionStateSource } from '@shared/contracts/dto'
import { truncateScrollback } from '@contexts/workspace/presentation/renderer/components/terminalNode/scrollback'
import { useScrollbackStore } from '@contexts/workspace/presentation/renderer/store/useScrollbackStore'
import { scheduleNodeScrollbackWrite } from '@contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule'
import { getPtyEventHub } from '../utils/ptyEventHub'
import { useAppStore } from '../store/useAppStore'
import { isAgentTreatedNode } from '@contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'
import { createTerminalAgentWatcherOwner } from '../utils/terminalAgentWatcherOwner'
import { projectAgentRuntimeObservation } from '@contexts/workspace/presentation/renderer/utils/agentRuntimeObservation'
import { updateWorkspacesWithAgentMetadata } from './usePtyWorkspaceRuntimeSync.agentMetadata'
export { updateWorkspacesWithAgentMetadata } from './usePtyWorkspaceRuntimeSync.agentMetadata'

function normalizeResumeSessionId(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') {
    return null
  }

  const trimmed = rawValue.trim()
  return trimmed.length > 0 ? trimmed : null
}

function updateWorkspacesWithAgentTreatedNodes(
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
      if (!isAgentTreatedNode(node) || node.data.sessionId !== sessionId) {
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

export function updateWorkspacesWithAgentRunState({
  workspaces,
  sessionId,
  state,
  source = 'session_file',
  hookInstallState = null,
  degraded = false,
}: {
  workspaces: WorkspaceState[]
  sessionId: string
  state: 'working' | 'waiting' | 'standby'
  source?: TerminalSessionStateSource
  hookInstallState?: AgentHookInstallState | null
  degraded?: boolean
}): { nextWorkspaces: WorkspaceState[]; didChange: boolean; durableDidChange: boolean } {
  let durableDidChange = false
  const result = updateWorkspacesWithAgentTreatedNodes(workspaces, {
    sessionId,
    updateNode: node => {
      const nextStatus: 'running' | 'waiting' | 'standby' =
        state === 'standby' ? 'standby' : state === 'waiting' ? 'waiting' : 'running'
      const nextObservation = { status: nextStatus, source, hookInstallState, degraded }
      if (node.data.kind === 'terminal') {
        const overlay = node.data.agentOverlay
        if (
          !overlay ||
          (overlay.status === nextStatus &&
            node.data.agentRuntimeObservation?.source === source &&
            node.data.agentRuntimeObservation.hookInstallState === hookInstallState &&
            node.data.agentRuntimeObservation.degraded === degraded)
        ) {
          return null
        }
        return {
          ...node,
          data: {
            ...node.data,
            agentOverlay: { ...overlay, status: nextStatus },
            agentRuntimeObservation: nextObservation,
          },
        }
      }

      const projected = projectAgentRuntimeObservation(node.data, {
        state,
        source,
        hookInstallState,
        degraded,
      })
      if (!projected) {
        return null
      }
      durableDidChange ||= projected.durableDidChange
      return { ...node, data: projected.data }
    },
  })

  return { ...result, durableDidChange }
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
    const invoke = window.opencoveApi.controlSurface?.invoke
    if (!invoke) {
      return undefined
    }

    const owner = createTerminalAgentWatcherOwner({
      invoke: request => invoke(request),
    })
    const ptyEventHub = getPtyEventHub()
    const sync = (): void => {
      const workspaces = useAppStore.getState().workspaces
      owner.sync(workspaces)
      const agentSessionIds = new Set<string>()
      for (const workspace of workspaces) {
        for (const node of workspace.nodes) {
          if (isAgentTreatedNode(node) && node.data.sessionId.trim().length > 0) {
            agentSessionIds.add(node.data.sessionId)
          }
        }
      }
      ptyEventHub.syncAgentRunStateSessions(agentSessionIds)
    }
    sync()
    const unsubscribe = useAppStore.subscribe(sync)

    return () => {
      unsubscribe()
      owner.dispose()
      ptyEventHub.syncAgentRunStateSessions(new Set())
    }
  }, [])

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
      let durableDidChange = false

      setWorkspaces(previous => {
        const result = updateWorkspacesWithAgentRunState({
          workspaces: previous,
          sessionId: event.sessionId,
          state: event.state,
          source: event.source,
          hookInstallState: event.hookInstallState,
          degraded: event.degraded,
        })

        didChange = result.didChange
        durableDidChange = result.durableDidChange
        return didChange ? result.nextWorkspaces : previous
      })

      if (didChange && durableDidChange) {
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
