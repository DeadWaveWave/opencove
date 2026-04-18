import { useEffect } from 'react'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { Node } from '@xyflow/react'
import type { AgentRuntimeStatus, TerminalNodeData } from '../../../types'

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

export function useWorkspaceCanvasPtyTaskCompletion({
  setNodes,
  onRequestPersistFlush,
}: {
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  onRequestPersistFlush?: () => void
}): void {
  useEffect(() => {
    const ptyEventHub = getPtyEventHub()

    const unsubscribeState = ptyEventHub.onState(event => {
      setNodes(prevNodes => applyAgentStateToNodes(prevNodes, event).nextNodes, {
        syncLayout: false,
      })
    })

    const unsubscribeMetadata = ptyEventHub.onMetadata(event => {
      let didChange = false

      setNodes(
        prevNodes => {
          const nextNodes = prevNodes.map(node => {
            if (
              node.data.kind !== 'agent' ||
              node.data.sessionId !== event.sessionId ||
              !node.data.agent
            ) {
              return node
            }

            const nextResumeSessionId =
              typeof event.resumeSessionId === 'string' && event.resumeSessionId.trim().length > 0
                ? event.resumeSessionId
                : null
            const nextResumeSessionIdVerified = nextResumeSessionId !== null

            if (
              node.data.agent.resumeSessionId === nextResumeSessionId &&
              node.data.agent.resumeSessionIdVerified === nextResumeSessionIdVerified
            ) {
              return node
            }

            if (nextResumeSessionId === null) {
              return node
            }

            didChange = true
            return {
              ...node,
              data: {
                ...node.data,
                agent: {
                  ...node.data.agent,
                  resumeSessionId: nextResumeSessionId,
                  resumeSessionIdVerified: true,
                },
              },
            }
          })

          return didChange ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )

      if (didChange) {
        onRequestPersistFlush?.()
      }
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
      unsubscribeState()
      unsubscribeMetadata()
      unsubscribeExit()
    }
  }, [onRequestPersistFlush, setNodes])
}
