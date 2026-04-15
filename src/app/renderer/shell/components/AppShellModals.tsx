import React from 'react'
import type { AgentProvider, AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { AppUpdateState, ReleaseNotesCurrentResult } from '@shared/contracts/dto'
import { SettingsPanel } from '@contexts/settings/presentation/renderer/SettingsPanel'
import type { SettingsPageId } from '@contexts/settings/presentation/renderer/SettingsPanel.shared'
import { WhatsNewDialog } from './WhatsNewDialog'

interface ProviderModelCatalogEntry {
  models: string[]
  source: string | null
  fetchedAt: string | null
  isLoading: boolean
  error: string | null
}

export interface WhatsNewDialogState {
  isOpen: boolean
  fromVersion: string | null
  toVersion: string | null
  notes: ReleaseNotesCurrentResult | null
  isLoading: boolean
  error: string | null
  compareUrl: string | null
  close: () => void
}

export function AppShellModals({
  isSettingsOpen,
  settingsInitialPageId,
  openSettingsPageId,
  settings,
  updateState,
  modelCatalogByProvider,
  workspaces,
  onWorkspaceWorktreesRootChange,
  isFocusNodeTargetZoomPreviewing,
  onFocusNodeTargetZoomPreviewChange,
  onChangeSettings,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onCloseSettings,
  whatsNew,
}: {
  isSettingsOpen: boolean
  settingsInitialPageId: SettingsPageId | null
  openSettingsPageId: SettingsPageId | null
  settings: AgentSettings
  updateState: AppUpdateState | null
  modelCatalogByProvider: Record<AgentProvider, ProviderModelCatalogEntry>
  workspaces: WorkspaceState[]
  onWorkspaceWorktreesRootChange: (workspaceId: string, worktreesRoot: string) => void
  isFocusNodeTargetZoomPreviewing: boolean
  onFocusNodeTargetZoomPreviewChange: (isPreviewing: boolean) => void
  onChangeSettings: (settings: AgentSettings) => void
  onCheckForUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onCloseSettings: () => void
  whatsNew: WhatsNewDialogState
}): React.JSX.Element {
  return (
    <>
      {isSettingsOpen ? (
        <SettingsPanel
          initialPageId={settingsInitialPageId}
          settings={settings}
          openPageId={openSettingsPageId}
          updateState={updateState}
          modelCatalogByProvider={modelCatalogByProvider}
          workspaces={workspaces}
          onWorkspaceWorktreesRootChange={onWorkspaceWorktreesRootChange}
          isFocusNodeTargetZoomPreviewing={isFocusNodeTargetZoomPreviewing}
          onFocusNodeTargetZoomPreviewChange={onFocusNodeTargetZoomPreviewChange}
          onChange={onChangeSettings}
          onCheckForUpdates={onCheckForUpdates}
          onDownloadUpdate={onDownloadUpdate}
          onInstallUpdate={onInstallUpdate}
          onClose={onCloseSettings}
        />
      ) : null}

      <WhatsNewDialog
        isOpen={whatsNew.isOpen}
        fromVersion={whatsNew.fromVersion}
        toVersion={whatsNew.toVersion}
        notes={whatsNew.notes}
        isLoading={whatsNew.isLoading}
        error={whatsNew.error}
        compareUrl={whatsNew.compareUrl}
        onClose={whatsNew.close}
      />
    </>
  )
}
