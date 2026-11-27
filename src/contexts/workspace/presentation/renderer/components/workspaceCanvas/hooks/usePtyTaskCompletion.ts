import { useEffect, useEffectEvent } from 'react'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { Node } from '@xyflow/react'
import { resolveAgentMetadataResumeBindingUpdate } from '@contexts/agent/domain/agentResumeBinding'
import type { AgentSessionSummary, TerminalSessionMetadataEvent } from '@shared/contracts/dto'
import type { TerminalNodeData } from '../../../types'
import {
  applyAgentSessionTitleToNodes,
  isAgentNodeAwaitingSessionTitle,
  isAgentSessionTitleSyncTargetCurrent,
  loadAgentSessionTitle,
  resolveAgentSessionTitleSyncTarget,
} from '../../../utils/agentSessionTitleSync'
import { projectAgentRuntimeObservation } from '../../../utils/agentRuntimeObservation'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'

export function applyAgentMetadataToNodes(
  prevNodes: Node<TerminalNodeData>[],
  event: {
    sessionId: string
    resumeSessionId: string | null | undefined
    piSnapshot?: TerminalSessionMetadataEvent['piSnapshot']
  },
): { nextNodes: Node<TerminalNodeData>[]; didChange: boolean } {
  let didChange = false

  const nextNodes = prevNodes.map(node => {
    if (node.data.kind !== 'agent' || node.data.sessionId !== event.sessionId || !node.data.agent) {
      return node
    }

    const update = resolveAgentMetadataResumeBindingUpdate(
      node.data.agent,
      {
        ...event,
        resumeSessionId: event.resumeSessionId ?? null,
      },
      node.data.managedClaudeResumeBindingOwnership,
    )
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
  workspaceId,
  nodes,
  listAgentSessions,
}: {
  workspaceId?: string
  nodes?: Node<TerminalNodeData>[]
  listAgentSessions?: (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>
}): void {
  // The reader belongs to the workspace of this render: a subscription made for one workspace
  // reads that workspace's committed nodes when an event arrives, and is rebuilt on a switch.
  const readDocument = useReadCanvasDocument()
  // Callback changes are not a new runtime lifetime. Re-subscribing replays cached metadata and
  // restarts title scans while the previous Worker's request is still running.
  const { updateNodes: writeNodes } = useCanvasNodeWriter()
  const updateNodes = useEffectEvent(writeNodes)
  const querySessionTitles = useEffectEvent(
    async (nodeId: string) => (await listAgentSessions?.(nodeId, 20)) ?? [],
  )
  const hasSessionCatalog = Boolean(listAgentSessions)

  useEffect(() => {
    const ptyEventHub = getPtyEventHub()
    const titleSyncByNodeId = new Map<string, { key: string; abortController: AbortController }>()
    const metadataByRuntimeSessionId = new Map<string, TerminalSessionMetadataEvent>()
    let disposed = false

    const startTitleSync = (event: TerminalSessionMetadataEvent, restart: boolean): void => {
      const titleSyncTarget = resolveAgentSessionTitleSyncTarget(readDocument().nodes, event)

      if (!titleSyncTarget || !hasSessionCatalog) {
        return
      }

      if (
        restart &&
        !readDocument().nodes.some(
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
        listSessions: () => querySessionTitles(titleSyncTarget.nodeId),
        isCurrent: () =>
          !disposed && isAgentSessionTitleSyncTargetCurrent(readDocument().nodes, titleSyncTarget),
        signal: abortController.signal,
      }).then(sessionTitle => {
        if (!sessionTitle || disposed || abortController.signal.aborted) {
          return
        }

        updateNodes(
          prevNodes =>
            applyAgentSessionTitleToNodes(prevNodes, titleSyncTarget, sessionTitle).nextNodes,
          { syncLayout: false, flush: true },
        )
      })
    }

    const unsubscribeState = ptyEventHub.onState(event => {
      if (event.state === 'standby') {
        const metadata = metadataByRuntimeSessionId.get(event.sessionId)
        if (metadata) {
          startTitleSync(metadata, true)
        }
      }
    })

    const unsubscribeMetadata = ptyEventHub.onMetadata(event => {
      metadataByRuntimeSessionId.set(event.sessionId, event)
      updateNodes(prevNodes => applyAgentMetadataToNodes(prevNodes, event).nextNodes, {
        syncLayout: false,
        flush: true,
      })

      startTitleSync(event, false)
    })

    return () => {
      disposed = true
      titleSyncByNodeId.forEach(sync => sync.abortController.abort())
      titleSyncByNodeId.clear()
      metadataByRuntimeSessionId.clear()
      unsubscribeState()
      unsubscribeMetadata()
    }
  }, [hasSessionCatalog, readDocument, workspaceId])

  useEffect(() => {
    if (!nodes) {
      return
    }
    // Recovery can bind a runtime after its hook event arrived. Reconcile from the existing
    // event owner without re-subscribing to metadata or restarting catalog scans.
    const hub = getPtyEventHub()
    // This effect runs on every `nodes` change, drag frames included. Decide from the argument
    // whether anything would project, so a frame that changes nothing never reaches the store.
    const hasProjectableNode = nodes.some(node => {
      if (node.data.kind !== 'agent') {
        return false
      }
      const cached = hub.getLatestSessionState(node.data.sessionId)
      return cached ? projectAgentRuntimeObservation(node.data, cached) !== null : false
    })
    if (!hasProjectableNode) {
      return
    }
    updateNodes(
      previous => {
        let didChange = false
        const next = previous.map(node => {
          if (node.data.kind !== 'agent') {
            return node
          }
          const cached = hub.getLatestSessionState(node.data.sessionId)
          const projected = cached ? projectAgentRuntimeObservation(node.data, cached) : null
          if (!projected) {
            return node
          }
          didChange = true
          return { ...node, data: projected.data }
        })
        return didChange ? next : previous
      },
      { syncLayout: false },
    )
  }, [nodes])
}
