import { useCallback } from 'react'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { RoleNodeData } from '../../../types'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'

export function useWorkspaceCanvasRoleNodeMutations(): {
  updateRoleProvider: (nodeId: string, provider: AgentProvider) => void
  updateRoleInput: (nodeId: string, input: string) => void
  appendRoleRunRecord: (
    nodeId: string,
    next: Pick<RoleNodeData, 'linkedAgentNodeId'> & {
      record: RoleNodeData['runHistory'][number]
    },
  ) => void
} {
  const { updateNodes } = useCanvasNodeWriter()
  const updateRoleProvider = useCallback(
    (nodeId: string, provider: AgentProvider) => {
      updateNodes(
        prevNodes => {
          let hasChanged = false
          const now = new Date().toISOString()
          const nextNodes = prevNodes.map(node => {
            if (node.id !== nodeId || node.data.kind !== 'role' || !node.data.role) {
              return node
            }

            if (node.data.role.selectedProvider === provider) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                role: {
                  ...node.data.role,
                  selectedProvider: provider,
                  updatedAt: now,
                },
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false, flush: true },
      )
    },
    [updateNodes],
  )

  const updateRoleInput = useCallback(
    (nodeId: string, input: string) => {
      updateNodes(
        prevNodes => {
          let hasChanged = false
          const now = new Date().toISOString()
          const nextNodes = prevNodes.map(node => {
            if (node.id !== nodeId || node.data.kind !== 'role' || !node.data.role) {
              return node
            }

            if (node.data.role.input === input) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                role: {
                  ...node.data.role,
                  input,
                  updatedAt: now,
                },
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false, flush: true },
      )
    },
    [updateNodes],
  )

  const appendRoleRunRecord = useCallback(
    (
      nodeId: string,
      next: Pick<RoleNodeData, 'linkedAgentNodeId'> & {
        record: RoleNodeData['runHistory'][number]
      },
    ) => {
      updateNodes(
        prevNodes => {
          let hasChanged = false
          const updatedAt = new Date().toISOString()
          const nextNodes = prevNodes.map(node => {
            if (node.id !== nodeId || node.data.kind !== 'role' || !node.data.role) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                role: {
                  ...node.data.role,
                  linkedAgentNodeId: next.linkedAgentNodeId,
                  runHistory: [next.record, ...node.data.role.runHistory].slice(0, 20),
                  updatedAt,
                },
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false, flush: true },
      )
    },
    [updateNodes],
  )

  return {
    updateRoleProvider,
    updateRoleInput,
    appendRoleRunRecord,
  }
}
