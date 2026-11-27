import type { MutableRefObject, ReactElement } from 'react'
import {
  normalizeSelectableAgentProviderOrder,
  resolveSelectableAgentProvider,
  type AgentProvider,
} from '@contexts/settings/domain/agentSettings'
import { RoleNode } from '../RoleNode'
import type { TerminalNodeData } from '../../types'
import { useNodePosition } from './nodePosition'
import { useCanvasNodeCommands } from './nodeTypes.context'

export function WorkspaceCanvasRoleNodeType({
  data,
  id,
  updateRoleProviderRef,
  updateRoleInputRef,
  runRoleRef,
  agentProviderOrder,
  defaultProvider,
}: {
  data: TerminalNodeData
  id: string
  updateRoleProviderRef: MutableRefObject<(nodeId: string, provider: AgentProvider) => void>
  updateRoleInputRef: MutableRefObject<(nodeId: string, input: string) => void>
  runRoleRef: MutableRefObject<(nodeId: string, inputOverride?: string) => Promise<void>>
  agentProviderOrder: AgentProvider[]
  defaultProvider: AgentProvider
}): ReactElement | null {
  const nodePosition = useNodePosition(id)
  const windowCommands = useCanvasNodeCommands().window

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
        windowCommands.requestDelete([id])
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
      onResize={frame => windowCommands.resize(id, frame)}
      onInteractionStart={options => {
        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            windowCommands.select(id, { toggle: true })
            return
          }

          windowCommands.select(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        windowCommands.focusForInteraction(id)
      }}
    />
  )
}
