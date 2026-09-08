import React, { useEffect, useMemo, useRef } from 'react'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { useTranslation } from '@app/renderer/i18n'
import { SettingsPanelHeader } from './settingsPanel/SettingsPanelHeader'
import { SettingsPanelSidebar } from './settingsPanel/SettingsPanelSidebar'
import { SettingsPanelSearch } from './settingsPanel/SettingsPanelSearch'
import { SettingsPanelContent } from './settingsPanel/SettingsPanelContent'
import { getFolderName, type SettingsPanelProps } from './SettingsPanel.shared'
import { useSettingsPanelPageState } from './useSettingsPanelPageState'
import { useSettingsPanelActions } from './useSettingsPanelActions'
import { useSettingsSearchNavigation } from './useSettingsSearchNavigation'
import { resolveSettingsPage } from './settingsPanel/settingsPageRegistry'

const SETTINGS_FOCUS_OUTSIDE_SELECTORS = ['.cove-window'] as const

export function SettingsPanel(props: SettingsPanelProps): React.JSX.Element {
  const {
    initialPageId,
    settings,
    openPageId,
    workspaces,
    onFocusNodeTargetZoomPreviewChange,
    isFocusNodeTargetZoomPreviewing,
    onClose,
  } = props
  const { t } = useTranslation()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const page = useSettingsPanelPageState({
    openPageId,
    workspaces,
    contentRef,
    onFocusNodeTargetZoomPreviewChange,
  })
  const { activePageId, canonicalPageId, setActivePageId, activeWorkspace } = page
  const resolvedActivePage = useMemo(() => resolveSettingsPage(activePageId), [activePageId])
  const actions = useSettingsPanelActions(props)
  const { agentRequest, selectPage, selectSearchResult } = useSettingsSearchNavigation({
    contentRef,
    activePageId,
    setActivePageId,
    defaultProvider: settings.defaultProvider,
  })

  useEffect(() => {
    if (openPageId) {
      selectPage(openPageId)
    }
  }, [openPageId, selectPage])

  useEffect(() => {
    if (initialPageId) {
      selectPage(initialPageId)
    }
  }, [initialPageId, selectPage])

  useEffect(() => {
    if (activePageId === 'endpoints' && !settings.experimentalRemoteWorkersEnabled) {
      selectPage('worker')
    }
  }, [activePageId, settings.experimentalRemoteWorkersEnabled, selectPage])

  const pageTitle = activeWorkspace
    ? activeWorkspace.name.trim() || getFolderName(activeWorkspace.path)
    : t(resolvedActivePage.navLabelKey)
  const pageDescription = activeWorkspace
    ? activeWorkspace.path
    : resolvedActivePage.descriptionKey
      ? t(resolvedActivePage.descriptionKey)
      : ''

  return (
    <Dialog
      open
      initialFocusRef={searchInputRef}
      backdropClassName={`settings-backdrop${isFocusNodeTargetZoomPreviewing ? ' settings-backdrop--preview' : ''}`}
      className={`settings-panel${isFocusNodeTargetZoomPreviewing ? ' settings-panel--preview' : ''}`}
      aria-labelledby="settings-panel-page-title"
      aria-describedby={pageDescription ? 'settings-panel-page-description' : undefined}
      data-testid="settings-panel"
      inertRootSelector=".app-shell"
      focusOutsideSelectors={SETTINGS_FOCUS_OUTSIDE_SELECTORS}
      fallbackReturnFocusSelector='[data-testid="app-header-settings"]'
      dismissOnEscape={false}
      onDismiss={onClose}
      onKeyDown={event => {
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          (event.target instanceof Element && event.target.closest('.cove-window'))
        ) {
          return
        }
        event.preventDefault()
        onClose()
      }}
    >
      <SettingsPanelSidebar
        activePageId={activePageId}
        workspaces={workspaces}
        onSelectPage={selectPage}
      />
      <div className="settings-panel__content-wrapper">
        <SettingsPanelHeader
          title={pageTitle}
          description={pageDescription}
          onClose={onClose}
          search={
            <SettingsPanelSearch
              searchInputRef={searchInputRef}
              workspaces={workspaces}
              endpointsEnabled={settings.experimentalRemoteWorkersEnabled}
              onSelectSearchResult={selectSearchResult}
            />
          }
        />
        <div className="settings-panel__content" ref={contentRef}>
          <SettingsPanelContent
            {...props}
            activePageId={activePageId}
            canonicalPageId={canonicalPageId}
            activeWorkspace={activeWorkspace}
            actions={actions}
            agentRequest={agentRequest}
            onSelectPage={selectPage}
          />
        </div>
      </div>
    </Dialog>
  )
}
