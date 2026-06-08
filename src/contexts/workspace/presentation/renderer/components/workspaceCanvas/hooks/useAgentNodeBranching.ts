import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentNodeData, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { isResumeSessionBindingVerified } from '../../../utils/agentResumeBinding'
import type { CreateNodeInput } from '../types'
import {
  findAgentNode,
  normalizeOptionalString,
  type RelaunchAgentNodeOptions,
} from './useAgentNodeLifecycle.support'

interface UseAgentNodeBranchingParams {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  setAgentNodeFailure: (nodeId: string, message: string) => void
  relaunchAgentNode: (options: RelaunchAgentNodeOptions) => Promise<void>
  onRequestPersistFlush?: () => void
}

export function useAgentNodeBranching({
  nodesRef,
  spacesRef,
  onSpacesChange,
  createNodeForSession,
  setAgentNodeFailure,
  relaunchAgentNode,
  onRequestPersistFlush,
}: UseAgentNodeBranchingParams): (nodeId: string) => Promise<void> {
  const { t } = useTranslation()

  return useCallback(
    async (nodeId: string): Promise<void> => {
      const node = findAgentNode(nodeId, nodesRef.current)
      if (!node) {
        return
      }

      const resumeSessionId = isResumeSessionBindingVerified(node.data.agent)
        ? normalizeOptionalString(node.data.agent.resumeSessionId)
        : null
      if (!resumeSessionId) {
        setAgentNodeFailure(nodeId, t('messages.resumeSessionMissing'))
        return
      }

      const sourceSpace = spacesRef.current.find(space => space.nodeIds.includes(nodeId)) ?? null
      const branchAgent: AgentNodeData = {
        provider: node.data.agent.provider,
        prompt: node.data.agent.prompt,
        model: node.data.agent.model,
        effectiveModel: node.data.agent.effectiveModel,
        launchMode: 'resume',
        resumeSessionId,
        resumeSessionIdVerified: true,
        executionDirectory: node.data.agent.executionDirectory,
        expectedDirectory: node.data.agent.expectedDirectory,
        directoryMode: node.data.agent.directoryMode,
        customDirectory: node.data.agent.customDirectory,
        shouldCreateDirectory: node.data.agent.shouldCreateDirectory,
        taskId: node.data.agent.taskId,
      }

      const branchNode = await createNodeForSession({
        sessionId: '',
        profileId: node.data.profileId ?? null,
        runtimeKind: node.data.runtimeKind,
        terminalGeometry: node.data.terminalGeometry ?? null,
        title: node.data.title,
        anchor: node.position,
        kind: 'agent',
        placement: {
          targetSpaceRect: sourceSpace?.rect ?? null,
          preferredDirection: 'right',
        },
        agent: branchAgent,
      })

      if (!branchNode) {
        return
      }

      if (sourceSpace) {
        const nextSpaces = spacesRef.current.map(space => {
          const filteredNodeIds = space.nodeIds.filter(candidateId => candidateId !== branchNode.id)
          if (space.id !== sourceSpace.id) {
            return { ...space, nodeIds: filteredNodeIds }
          }

          return { ...space, nodeIds: [...filteredNodeIds, branchNode.id] }
        })
        spacesRef.current = nextSpaces
        onSpacesChange(nextSpaces)
        onRequestPersistFlush?.()
      }

      await relaunchAgentNode({
        nodeId: branchNode.id,
        mode: 'resume',
        executionDirectory: node.data.agent.executionDirectory,
        expectedDirectory: node.data.agent.expectedDirectory,
        resumeSessionId,
      })

      onRequestPersistFlush?.()
    },
    [
      createNodeForSession,
      nodesRef,
      onRequestPersistFlush,
      onSpacesChange,
      relaunchAgentNode,
      setAgentNodeFailure,
      spacesRef,
      t,
    ],
  )
}
