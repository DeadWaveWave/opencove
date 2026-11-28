import { useState } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { CanvasNodeCommands } from '../nodeCommands'
import { useWorkspaceCanvasNodeTypes } from '../nodeTypes'

export function useWorkspaceCanvasComposedNodeTypes({
  workspacePath,
  onShowMessage,
  agentSettings,
  commands,
}: {
  workspacePath: string
  onShowMessage?: Parameters<typeof useWorkspaceCanvasNodeTypes>[0]['onShowMessage']
  agentSettings: Pick<
    AgentSettings,
    'agentProviderOrder' | 'defaultProvider' | 'browserDefaultMode' | 'browserSearchEngine'
  >
  commands: CanvasNodeCommands
}) {
  // The settings can arrive as a new object with equal preferences (a Worker sync): the array of
  // the order keeps its identity while its content is equal (Decision 14).
  const agentProviderOrder = useSameWhileEqual(agentSettings.agentProviderOrder)
  return useWorkspaceCanvasNodeTypes({
    workspacePath,
    onShowMessage,
    agentProviderOrder,
    defaultProvider: agentSettings.defaultProvider,
    browserDefaultMode: agentSettings.browserDefaultMode,
    browserSearchEngine: agentSettings.browserSearchEngine,
    commands,
  })
}

/** The previous array while the content is equal (React's "information from previous renders"). */
function useSameWhileEqual<T>(value: readonly T[]): T[] {
  const [held, setHeld] = useState(value)
  const equal = held.length === value.length && held.every((item, index) => item === value[index])
  if (!equal) {
    setHeld(value)
    return value as T[]
  }
  return held as T[]
}
