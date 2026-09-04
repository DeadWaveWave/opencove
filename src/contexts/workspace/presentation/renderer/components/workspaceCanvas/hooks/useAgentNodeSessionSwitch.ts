import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { AgentSessionSummary } from '@shared/contracts/dto'
import type { TerminalNodeData } from '../../../types'
import {
  appendTaskAgentSessionRecordToHistory,
  createTaskAgentSessionRecord,
} from '../../../utils/agentSessionHistory'
import { isResumeSessionBindingVerified } from '../../../utils/agentResumeBinding'
import { findAgentNode, type RelaunchAgentNodeOptions } from './useAgentNodeLifecycle.support'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export function useAgentNodeSessionSwitch({
  nodesRef,
  setNodes,
  relaunchAgentNode,
  onRequestPersistFlush,
}: {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  relaunchAgentNode: (options: RelaunchAgentNodeOptions) => Promise<void>
  onRequestPersistFlush?: () => void
}): (nodeId: string, summary: AgentSessionSummary) => Promise<void> {
  return useCallback(
    async (nodeId: string, summary: AgentSessionSummary) => {
      const node = findAgentNode(nodeId, nodesRef.current)
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

      await relaunchAgentNode({
        nodeId,
        mode: 'resume',
        executionDirectory: summary.cwd,
        expectedDirectory: summary.cwd,
        resumeSessionId: summary.sessionId,
        startedAtOverride: summary.startedAt ?? undefined,
      })

      const switchedNode = findAgentNode(nodeId, nodesRef.current)
      const switchCommitted =
        switchedNode !== null &&
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
      onRequestPersistFlush?.()
    },
    [nodesRef, onRequestPersistFlush, relaunchAgentNode, setNodes],
  )
}
