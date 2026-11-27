import type { ManagedClaudeLifecycleReceipt } from '@shared/contracts/managedClaudeLaunch'
import { useCallback } from 'react'
import type { AgentSessionSummary } from '@shared/contracts/dto'
import {
  appendTaskAgentSessionRecordToHistory,
  createTaskAgentSessionRecord,
} from '../../../utils/agentSessionHistory'
import { isResumeSessionBindingVerified } from '../../../utils/agentResumeBinding'
import { useCanvasDocumentCommands, useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { findAgentNode, type RelaunchAgentNodeOptions } from './useAgentNodeLifecycle.support'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

export function useAgentNodeSessionSwitch({
  setNodes,
  relaunchAgentNode,
}: {
  setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes']
  relaunchAgentNode: (
    options: RelaunchAgentNodeOptions,
  ) => Promise<void | ManagedClaudeLifecycleReceipt>
}): (nodeId: string, summary: AgentSessionSummary) => Promise<void> {
  const readDocument = useReadCanvasDocument()
  const { requestPersistFlush } = useCanvasDocumentCommands()

  return useCallback(
    async (nodeId: string, summary: AgentSessionSummary) => {
      const node = findAgentNode(nodeId, readDocument().nodes)
      if (!node || summary.provider !== node.data.agent.provider) {
        return
      }

      const currentResumeSessionId = isResumeSessionBindingVerified(node.data.agent)
        ? node.data.agent.resumeSessionId
        : null
      if (
        currentResumeSessionId === summary.sessionId &&
        node.data.agent.executionDirectory === summary.cwd
      ) {
        return
      }

      const switchedAt = new Date().toISOString()
      const previousTaskNodeId = currentResumeSessionId ? (node.data.agent.taskId ?? null) : null
      const previousSessionRecord = previousTaskNodeId
        ? createTaskAgentSessionRecord(node, switchedAt)
        : null

      const receipt = await relaunchAgentNode({
        nodeId,
        mode: 'resume',
        executionDirectory: summary.cwd,
        expectedDirectory: summary.cwd,
        resumeSessionId: summary.sessionId,
        startedAtOverride: summary.startedAt ?? undefined,
      })

      const switchedNode = findAgentNode(nodeId, readDocument().nodes)
      const switchCommitted = receipt
        ? receipt.binding.tuple.resumeSessionId === summary.sessionId
        : switchedNode !== null &&
          isResumeSessionBindingVerified(switchedNode.data.agent) &&
          switchedNode.data.agent.resumeSessionId === summary.sessionId &&
          switchedNode.data.agent.executionDirectory === summary.cwd
      if (switchCommitted && previousTaskNodeId && previousSessionRecord) {
        setNodes(
          prevNodes =>
            appendTaskAgentSessionRecordToHistory({
              prevNodes,
              taskNodeId: previousTaskNodeId,
              agentSessionRecord: previousSessionRecord,
              now: switchedAt,
            }),
          { syncLayout: false },
        )
      }
      // The switch flushes once, at its end, whatever the history write did: the switch itself was
      // written by the relaunch, and the history write changes nothing when the task was deleted
      // meanwhile. It is not the flush of one write.
      requestPersistFlush()
    },
    [readDocument, relaunchAgentNode, requestPersistFlush, setNodes],
  )
}
