import type { AgentProvider, AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { AppUpdateState } from '@shared/contracts/dto'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'

export interface ProviderModelCatalogEntry {
  models: string[]
  source: string | null
  fetchedAt: string | null
  isLoading: boolean
  error: string | null
}

export interface SettingsPanelProps {
  initialPageId?: SettingsPageId | null
  settings: AgentSettings
  openPageId?: SettingsPageId | null
  updateState: AppUpdateState | null
  modelCatalogByProvider: Record<AgentProvider, ProviderModelCatalogEntry>
  workspaces: WorkspaceState[]
  onWorkspaceWorktreesRootChange: (workspaceId: string, worktreesRoot: string) => void
  isFocusNodeTargetZoomPreviewing: boolean
  onFocusNodeTargetZoomPreviewChange: (isPreviewing: boolean) => void
  onChange: (settings: AgentSettings) => void
  onCheckForUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onClose: () => void
}

type CorePageId =
  | 'general'
  | 'worker'
  | 'endpoints'
  | 'agent'
  | 'quick-menu'
  | 'notifications'
  | 'canvas'
  | 'experimental'
  | 'shortcuts'
  | 'task-configuration'
  | 'integrations'
type WorkspacePageId = `workspace:${string}`
export type SettingsPageId = CorePageId | WorkspacePageId

export function getWorkspacePageId(workspaceId: string): WorkspacePageId {
  return `workspace:${workspaceId}`
}

export function isWorkspacePageId(pageId: SettingsPageId): pageId is WorkspacePageId {
  return pageId.startsWith('workspace:')
}

export function createInitialInputState(
  providers: readonly AgentProvider[],
): Record<AgentProvider, string> {
  return providers.reduce<Record<AgentProvider, string>>(
    (acc, provider) => {
      acc[provider] = ''
      return acc
    },
    {} as Record<AgentProvider, string>,
  )
}

export function getFolderName(path: string): string {
  const parts = path.split(/[/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}
