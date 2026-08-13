import type { MutableRefObject, ReactElement } from 'react'
import {
  normalizeSelectableAgentProviderOrder,
  resolveSelectableAgentProvider,
  type AgentProvider,
} from '@contexts/settings/domain/agentSettings'
import { RoleNode } from '../RoleNode'
import type { NodeFrame, TerminalNodeData } from '../../types'
import { useNodePosition } from './nodePosition'

export function WorkspaceCanvasRoleNodeType({
  data,
  id,
  selectNode,
  requestNodeDeleteRef,
  resizeNodeRef,
  updateRoleProviderRef,
  updateRoleInputRef,
  runRoleRef,
  normalizeViewportForTerminalInteractionRef,
  agentProviderOrder,
  defaultProvider,
}: {
  data: TerminalNodeData
  id: string
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  requestNodeDeleteRef: MutableRefObject<(nodeIds: string[]) => void>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  updateRoleProviderRef: MutableRefObject<(nodeId: string, provider: AgentProvider) => void>
  updateRoleInputRef: MutableRefObject<(nodeId: string, input: string) => void>
  runRoleRef: MutableRefObject<(nodeId: string, inputOverride?: string) => Promise<void>>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
  agentProviderOrder: AgentProvider[]
  defaultProvider: AgentProvider
}): ReactElement | null {
  const nodePosition = useNodePosition(id)

  if (!data.role) {
    return null
  }

  const selectedProvider = resolveSelectableAgentProvider(
    data.role.selectedProvider ?? defaultProvider,
  )
  const providerOptions = normalizeSelectableAgentProviderOrder(agentProviderOrder)

  return (
    <RoleNode
      title={data.title}
      role={data.role}
      position={nodePosition}
      width={data.width}
      height={data.height}
      providerOptions={providerOptions}
      selectedProvider={selectedProvider}
      lastError={data.lastError}
      onClose={() => {
        requestNodeDeleteRef.current([id])
      }}
      onProviderChange={provider => {
        updateRoleProviderRef.current(id, provider)
      }}
      onInputSave={input => {
        updateRoleInputRef.current(id, input)
      }}
      onRun={input => {
        void runRoleRef.current(id, input)
      }}
      onResize={frame => resizeNodeRef.current(id, frame)}
      onInteractionStart={options => {
        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            selectNode(id, { toggle: true })
            return
          }

          selectNode(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        normalizeViewportForTerminalInteractionRef.current(id)
      }}
    />
  )
}
