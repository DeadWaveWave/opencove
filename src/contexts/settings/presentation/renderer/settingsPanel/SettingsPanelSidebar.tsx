import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { getFolderName, getWorkspacePageId, type SettingsPageId } from '../SettingsPanel.shared'
import { SettingsPanelNavButton } from './SettingsPanelNavButton'

export function SettingsPanelSidebar({
  activePageId,
  workspaces,
  endpointsEnabled,
  onSelectPage,
}: {
  activePageId: SettingsPageId
  workspaces: WorkspaceState[]
  endpointsEnabled: boolean
  onSelectPage: (pageId: SettingsPageId) => void
}): JSX.Element {
  const { t } = useTranslation()

  return (
    <aside className="settings-panel__sidebar" aria-label={t('settingsPanel.nav.sectionsLabel')}>
      <SettingsPanelNavButton
        isActive={activePageId === 'general'}
        label={t('settingsPanel.nav.general')}
        testId="settings-section-nav-general"
        onClick={() => onSelectPage('general')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'worker'}
        label={t('settingsPanel.nav.worker')}
        testId="settings-section-nav-worker"
        onClick={() => onSelectPage('worker')}
      />
      {endpointsEnabled ? (
        <SettingsPanelNavButton
          isActive={activePageId === 'endpoints'}
          label={t('settingsPanel.nav.endpoints')}
          testId="settings-section-nav-endpoints"
          onClick={() => onSelectPage('endpoints')}
        />
      ) : null}
      <SettingsPanelNavButton
        isActive={activePageId === 'agent'}
        label={t('settingsPanel.nav.agent')}
        testId="settings-section-nav-agent"
        onClick={() => onSelectPage('agent')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'notifications'}
        label={t('settingsPanel.nav.notifications')}
        testId="settings-section-nav-notifications"
        onClick={() => onSelectPage('notifications')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'canvas'}
        label={t('settingsPanel.nav.canvas')}
        testId="settings-section-nav-canvas"
        onClick={() => onSelectPage('canvas')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'shortcuts'}
        label={t('settingsPanel.nav.shortcuts')}
        testId="settings-section-nav-shortcuts"
        onClick={() => onSelectPage('shortcuts')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'quick-menu'}
        label={t('settingsPanel.nav.quickMenu')}
        testId="settings-section-nav-quick-menu"
        onClick={() => onSelectPage('quick-menu')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'task-configuration'}
        label={t('settingsPanel.nav.tasks')}
        testId="settings-section-nav-task-configuration"
        onClick={() => onSelectPage('task-configuration')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'integrations'}
        label={t('settingsPanel.nav.integrations')}
        testId="settings-section-nav-integrations"
        onClick={() => onSelectPage('integrations')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'experimental'}
        label={t('settingsPanel.nav.experimental')}
        testId="settings-section-nav-experimental"
        onClick={() => onSelectPage('experimental')}
      />

      <div className="settings-panel__nav-group-label">{t('settingsPanel.nav.projects')}</div>
      <div className="settings-panel__nav-group">
        {workspaces.map(workspace => (
          <SettingsPanelNavButton
            key={workspace.id}
            isActive={activePageId === getWorkspacePageId(workspace.id)}
            label={
              workspace.name.trim().length > 0 ? workspace.name : getFolderName(workspace.path)
            }
            onClick={() => onSelectPage(getWorkspacePageId(workspace.id))}
          />
        ))}
      </div>
    </aside>
  )
}
