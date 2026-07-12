import { useEffect, type MutableRefObject } from 'react'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { Node } from '@xyflow/react'
import { resolveObservedResumeSessionBindingUpdate } from '@contexts/agent/domain/agentResumeBinding'
import type { AgentSessionSummary, TerminalSessionMetadataEvent } from '@shared/contracts/dto'
import type { AgentRuntimeStatus, TerminalNodeData } from '../../../types'
import {
  applyAgentSessionTitleToNodes,
  isAgentNodeAwaitingSessionTitle,
  isAgentSessionTitleSyncTargetCurrent,
  loadAgentSessionTitle,
  resolveAgentSessionTitleSyncTarget,
} from '../../../utils/agentSessionTitleSync'

export function applyAgentStateToNodes(
  prevNodes: Node<TerminalNodeData>[],
  event: { sessionId: string; state: 'working' | 'standby' },
): { nextNodes: Node<TerminalNodeData>[]; didChange: boolean } {
  let didChange = false

  const nextNodes = prevNodes.map(node => {
    if (node.data.kind !== 'agent' || node.data.sessionId !== event.sessionId) {
      return node
    }

    if (
      node.data.status === 'failed' ||
      node.data.status === 'stopped' ||
      node.data.status === 'exited'
    ) {
      return node
    }

    const nextStatus: AgentRuntimeStatus = event.state === 'standby' ? 'standby' : 'running'
    if (node.data.status === nextStatus) {
      return node
    }

    didChange = true
    return {
      ...node,
      data: {
        ...node.data,
        status: nextStatus,
      },
    }
  })

  return {
    nextNodes: didChange ? nextNodes : prevNodes,
    didChange,
  }
}

export function applyAgentExitToNodes(
  prevNodes: Node<TerminalNodeData>[],
  event: { sessionId: string; exitCode: number },
): { nextNodes: Node<TerminalNodeData>[]; didChange: boolean } {
  let didChange = false

  const nextNodes = prevNodes.map(node => {
    if (node.data.sessionId !== event.sessionId || node.data.kind !== 'agent') {
      return node
    }

    if (node.data.status === 'stopped') {
      return node
    }

    didChange = true

    return {
      ...node,
      data: {
        ...node.data,
        status: event.exitCode === 0 ? ('exited' as const) : ('failed' as const),
        endedAt: new Date().toISOString(),
        exitCode: event.exitCode,
      },
    }
  })

  return {
    nextNodes: didChange ? nextNodes : prevNodes,
    didChange,
  }
}

export function applyAgentMetadataToNodes(
  prevNodes: Node<TerminalNodeData>[],
  event: { sessionId: string; resumeSessionId: string | null | undefined },
): { nextNodes: Node<TerminalNodeData>[]; didChange: boolean } {
  let didChange = false

  const nextNodes = prevNodes.map(node => {
    if (node.data.kind !== 'agent' || node.data.sessionId !== event.sessionId || !node.data.agent) {
      return node
    }

    const update = resolveObservedResumeSessionBindingUpdate(node.data.agent, event.resumeSessionId)
    if (!update) {
      return node
    }

    didChange = true
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

  return {
    nextNodes: didChange ? nextNodes : prevNodes,
    didChange,
  }
}

export function useWorkspaceCanvasPtyTaskCompletion({
  nodesRef,
  setNodes,
  listAgentSessions,
  onRequestPersistFlush,
}: {
  nodesRef?: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  listAgentSessions?: (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>
  onRequestPersistFlush?: () => void
}): void {
  useEffect(() => {
    const ptyEventHub = getPtyEventHub()
    const titleSyncByNodeId = new Map<string, { key: string; abortController: AbortController }>()
    const metadataByRuntimeSessionId = new Map<string, TerminalSessionMetadataEvent>()
    let disposed = false

    const startTitleSync = (event: TerminalSessionMetadataEvent, restart: boolean): void => {
      const titleSyncTarget = nodesRef
        ? resolveAgentSessionTitleSyncTarget(nodesRef.current, event)
        : null

      if (!titleSyncTarget || !nodesRef || !listAgentSessions) {
        return
      }

      if (
        restart &&
        !nodesRef.current.some(
          node => node.id === titleSyncTarget.nodeId && isAgentNodeAwaitingSessionTitle(node),
        )
      ) {
        return
      }

      const syncKey = `${titleSyncTarget.runtimeSessionId}:${titleSyncTarget.resumeSessionId}`
      const previousSync = titleSyncByNodeId.get(titleSyncTarget.nodeId)
      if (previousSync?.key === syncKey && !restart) {
        return
      }

      previousSync?.abortController.abort()
      const abortController = new AbortController()
      titleSyncByNodeId.set(titleSyncTarget.nodeId, {
        key: syncKey,
        abortController,
      })

      void loadAgentSessionTitle({
        resumeSessionId: titleSyncTarget.resumeSessionId,
        listSessions: () => listAgentSessions(titleSyncTarget.nodeId, 20),
        isCurrent: () =>
          !disposed && isAgentSessionTitleSyncTargetCurrent(nodesRef.current, titleSyncTarget),
        signal: abortController.signal,
      }).then(sessionTitle => {
        if (!sessionTitle || disposed || abortController.signal.aborted) {
          return
        }

        let titleDidChange = false
        setNodes(
          prevNodes => {
            const result = applyAgentSessionTitleToNodes(prevNodes, titleSyncTarget, sessionTitle)
            titleDidChange = result.didChange
            return result.nextNodes
          },
          { syncLayout: false },
        )

        if (titleDidChange) {
          onRequestPersistFlush?.()
        }
      })
    }

    const unsubscribeState = ptyEventHub.onState(event => {
      setNodes(prevNodes => applyAgentStateToNodes(prevNodes, event).nextNodes, {
        syncLayout: false,
      })

      if (event.state === 'standby') {
        const metadata = metadataByRuntimeSessionId.get(event.sessionId)
        if (metadata) {
          startTitleSync(metadata, true)
        }
      }
    })

    const unsubscribeMetadata = ptyEventHub.onMetadata(event => {
      metadataByRuntimeSessionId.set(event.sessionId, event)
      let didChange = false

      setNodes(
        prevNodes => {
          const result = applyAgentMetadataToNodes(prevNodes, event)
          didChange = result.didChange
          return result.nextNodes
        },
        { syncLayout: false },
      )

      if (didChange) {
        onRequestPersistFlush?.()
      }

      startTitleSync(event, false)
    })

    const unsubscribeExit = ptyEventHub.onExit(event => {
      let didChange = false

      setNodes(
        prevNodes => {
          const result = applyAgentExitToNodes(prevNodes, event)
          didChange = result.didChange
          return result.nextNodes
        },
        { syncLayout: false },
      )

      if (didChange) {
        onRequestPersistFlush?.()
      }
    })

    return () => {
      disposed = true
      titleSyncByNodeId.forEach(sync => sync.abortController.abort())
      titleSyncByNodeId.clear()
      metadataByRuntimeSessionId.clear()
      unsubscribeState()
      unsubscribeMetadata()
      unsubscribeExit()
    }
  }, [listAgentSessions, nodesRef, onRequestPersistFlush, setNodes])
}
