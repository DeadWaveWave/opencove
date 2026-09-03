import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { useAppQuitPersistenceFlush } from './useAppQuitPersistenceFlush'
import { usePtyWorkspaceRuntimeSync } from './usePtyWorkspaceRuntimeSync'
import { useTerminalDisplayAlignmentLifecycle } from './useTerminalDisplayAlignmentLifecycle'
import { useWorkerSyncStateUpdates } from './useWorkerSyncStateUpdates'
import { useWorkspaceMountRepair } from './useWorkspaceMountRepair'
import { useWebsiteWindowEvents } from './useWebsiteWindowEvents'
import { useWebsiteWindowPolicySync } from './useWebsiteWindowPolicySync'

export function useAppShellRuntimeLifecycles(options: {
  isPersistReady: boolean
  workspaces: WorkspaceState[]
  requestPersistFlush: () => void
  agentSettings: AgentSettings
  setAgentSettings: (action: AgentSettings | ((previous: AgentSettings) => AgentSettings)) => void
}): TerminalClientDisplayCalibration | null {
  usePtyWorkspaceRuntimeSync({ requestPersistFlush: options.requestPersistFlush })
  useAppQuitPersistenceFlush({ enabled: options.isPersistReady })
  useWorkerSyncStateUpdates({ enabled: options.isPersistReady })
  useWorkspaceMountRepair({
    enabled: options.isPersistReady,
    workspaces: options.workspaces,
    requestPersistFlush: options.requestPersistFlush,
  })
  useWebsiteWindowEvents()
  useWebsiteWindowPolicySync(options.agentSettings.websiteWindowPolicy)
  return useTerminalDisplayAlignmentLifecycle({
    isPersistReady: options.isPersistReady,
    agentSettings: options.agentSettings,
    setAgentSettings: options.setAgentSettings,
  })
}
