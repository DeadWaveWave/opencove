import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { WiredCanvasNodeCommands } from '../nodeCommands'
import type { WorkspaceCanvasActionRefs } from './useActionRefs'
import { useWorkspaceCanvasNodeTypes } from '../nodeTypes'

export function useWorkspaceCanvasComposedNodeTypes({
  workspacePath,
  onShowMessage,
  agentSettings,
  actionRefs,
  commands,
}: {
  workspacePath: string
  onShowMessage?: Parameters<typeof useWorkspaceCanvasNodeTypes>[0]['onShowMessage']
  agentSettings: Pick<
    AgentSettings,
    'agentProviderOrder' | 'defaultProvider' | 'browserDefaultMode' | 'browserSearchEngine'
  >
  actionRefs: WorkspaceCanvasActionRefs
  commands: WiredCanvasNodeCommands
}) {
  return useWorkspaceCanvasNodeTypes({
    workspacePath,
    onShowMessage,
    agentProviderOrder: agentSettings.agentProviderOrder,
    defaultProvider: agentSettings.defaultProvider,
    browserDefaultMode: agentSettings.browserDefaultMode,
    browserSearchEngine: agentSettings.browserSearchEngine,
    commands,
    ...actionRefs,
  })
}
