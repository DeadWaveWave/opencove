import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { AgentSessionSummary } from '@shared/contracts/dto'
import type { TerminalNodeData } from '../../../types'
import { invalidateCachedTerminalScreenState } from '../../terminalNode/screenStateCache'
import { findAgentNode } from './useAgentNodeLifecycle.support'

export function useAgentNodeSessionControls({
  nodesRef,
  setNodes,
  bumpAgentLaunchToken,
}: {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: (
    updater: (previous: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  bumpAgentLaunchToken: (nodeId: string) => number
}) {
  const listAgentSessionsForNode = useCallback(
    async (nodeId: string, limit = 20): Promise<AgentSessionSummary[]> => {
      const node = findAgentNode(nodeId, nodesRef.current)
      if (!node) {
        return []
      }

      const cwd = node.data.agent.executionDirectory.trim()
      if (cwd.length === 0) {
        return []
      }

      const result = await window.opencoveApi.agent.listSessions({
        provider: node.data.agent.provider,
        cwd,
        limit,
      })

      return result.sessions
    },
    [nodesRef],
  )

  const stopAgentNode = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find(item => item.id === nodeId)
      if (!node || node.data.kind !== 'agent') {
        return
      }

      bumpAgentLaunchToken(nodeId)

      if (node.data.sessionId.length > 0) {
        invalidateCachedTerminalScreenState(nodeId, node.data.sessionId)
        await window.opencoveApi.pty.kill({ sessionId: node.data.sessionId })
      }

      setNodes(
        prevNodes =>
          prevNodes.map(item => {
            if (item.id !== nodeId) {
              return item
            }

            return {
              ...item,
              data: {
                ...item.data,
                status: 'stopped',
                endedAt: new Date().toISOString(),
                exitCode: null,
              },
            }
          }),
        { syncLayout: false },
      )
    },
    [bumpAgentLaunchToken, nodesRef, setNodes],
  )

  return { listAgentSessionsForNode, stopAgentNode }
}
