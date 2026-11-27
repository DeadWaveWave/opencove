import { readManagedClaudeBinding } from '../../../utils/managedClaudeLifecycle'
import { useCallback } from 'react'
import type { AgentSessionSummary } from '@shared/contracts/dto'
import { invalidateCachedTerminalScreenState } from '../../terminalNode/screenStateCache'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'
import { findAgentNode } from './useAgentNodeLifecycle.support'

export function useAgentNodeSessionControls({
  bumpAgentLaunchToken,
}: {
  bumpAgentLaunchToken: (nodeId: string) => number
}) {
  const readDocument = useReadCanvasDocument()
  const { updateNodes } = useCanvasNodeWriter()

  const listAgentSessionsForNode = useCallback(
    async (nodeId: string, limit = 20): Promise<AgentSessionSummary[]> => {
      const node = findAgentNode(nodeId, readDocument().nodes)
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
    [readDocument],
  )

  const stopAgentNode = useCallback(
    async (nodeId: string) => {
      const node = readDocument().nodes.find(item => item.id === nodeId)
      if (!node || node.data.kind !== 'agent') {
        return
      }

      bumpAgentLaunchToken(nodeId)

      if (node.data.sessionId.length > 0) {
        invalidateCachedTerminalScreenState(nodeId, node.data.sessionId)
        const binding = await readManagedClaudeBinding(nodeId, node.data.agent?.provider)
        if (binding) {
          await window.opencoveApi.controlSurface.invoke({
            kind: 'command',
            id: 'session.kill',
            clientFeatures: { managedClaudeResumeBindingV1: true },
            payload: { sessionId: node.data.sessionId },
          })
        } else {
          await window.opencoveApi.pty.kill({ sessionId: node.data.sessionId })
        }
      }

      updateNodes(
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
    [bumpAgentLaunchToken, readDocument, updateNodes],
  )

  return { listAgentSessionsForNode, stopAgentNode }
}
