import React, { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { SettingsPageFrame } from './settingsPanel/SettingsPageFrame'
import { SettingsPanelHeader } from './settingsPanel/SettingsPanelHeader'
import { SettingsPanelSidebar } from './settingsPanel/SettingsPanelSidebar'
import { SettingsPanelSearch } from './settingsPanel/SettingsPanelSearch'
import { SettingsPanelContent } from './settingsPanel/SettingsPanelContent'
import { getFolderName, type SettingsPanelProps } from './SettingsPanel.shared'
import { useSettingsPanelPageState } from './useSettingsPanelPageState'
import { useSettingsPanelActions } from './useSettingsPanelActions'
import { useSettingsSearchNavigation } from './useSettingsSearchNavigation'
import { resolveSettingsPage } from './settingsPanel/settingsPageRegistry'

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

  const pageTitle = activeWorkspace
    ? activeWorkspace.name.trim() || getFolderName(activeWorkspace.path)
    : t(resolvedActivePage.navLabelKey)
  const pageDescription = activeWorkspace
    ? activeWorkspace.path
    : resolvedActivePage.descriptionKey
      ? t(resolvedActivePage.descriptionKey)
      : ''

  return (
    <SettingsPageFrame
      searchInputRef={searchInputRef}
      isPreviewing={isFocusNodeTargetZoomPreviewing}
      onClose={onClose}
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
          search={
            <SettingsPanelSearch
              searchInputRef={searchInputRef}
              workspaces={workspaces}
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
    </SettingsPageFrame>
  )
}
