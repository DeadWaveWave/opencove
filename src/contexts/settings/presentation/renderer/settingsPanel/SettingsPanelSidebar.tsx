import { useEffect, useRef, type JSX } from 'react'
import {
  FolderKanban,
  Keyboard,
  LayoutDashboard,
  Palette,
  Puzzle,
  Server,
  Settings2,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import {
  getFolderName,
  getWorkspacePageId,
  isWorkspacePageId,
  type SettingsPageId,
} from '../SettingsPanel.shared'
import { SettingsPanelNavButton } from './SettingsPanelNavButton'
import {
  CANONICAL_SETTINGS_PAGE_DEFINITIONS,
  SETTINGS_PRIMARY_PAGE_IDS,
  resolveSettingsPage,
  type CanonicalSettingsPageId,
  type SettingsPageIconId,
} from './settingsPageRegistry'

const SETTINGS_PAGE_ICONS: Record<SettingsPageIconId, LucideIcon> = {
  settings: Settings2,
  palette: Palette,
  'layout-dashboard': LayoutDashboard,
  sparkles: Sparkles,
  puzzle: Puzzle,
  terminal: SquareTerminal,
  keyboard: Keyboard,
  server: Server,
  wrench: Wrench,
  folder: FolderKanban,
}

export function SettingsPanelSidebar({
  activePageId,
  workspaces,
  onSelectPage,
}: {
  activePageId: SettingsPageId
  workspaces: WorkspaceState[]
  onSelectPage: (pageId: SettingsPageId) => void
}): JSX.Element {
  const { t } = useTranslation()
  const lastApplicationPageRef = useRef<SettingsPageId>('general')
  const isProject = isWorkspacePageId(activePageId)
  const resolvedActivePage = resolveSettingsPage(activePageId)
  useEffect(() => {
    if (!isWorkspacePageId(activePageId)) {
      lastApplicationPageRef.current = activePageId
    }
  }, [activePageId])

  const pageOptions = [...SETTINGS_PRIMARY_PAGE_IDS, 'advanced' as const].map(pageId => ({
    value: pageId,
    label: t(CANONICAL_SETTINGS_PAGE_DEFINITIONS[pageId].navLabelKey),
  }))
  const scopeOptions = [
    { value: 'app', label: t('settingsPanel.navigation.applicationScope') },
    ...workspaces.map(workspace => ({
      value: getWorkspacePageId(workspace.id),
      label: workspace.name.trim() || getFolderName(workspace.path),
    })),
  ]
  const renderPage = (pageId: CanonicalSettingsPageId) => {
    const definition = CANONICAL_SETTINGS_PAGE_DEFINITIONS[pageId]
    const Icon = SETTINGS_PAGE_ICONS[definition.iconId]
    return (
      <SettingsPanelNavButton
        key={pageId}
        isActive={resolvedActivePage.canonicalPageId === pageId}
        icon={<Icon size={16} aria-hidden="true" />}
        label={t(definition.navLabelKey)}
        testId={definition.testId}
        onClick={() => onSelectPage(pageId)}
      />
    )
  }

  return (
    <aside className="settings-panel__sidebar" aria-label={t('settingsPanel.nav.sectionsLabel')}>
      <div className="settings-panel__scope">
        <span className="settings-panel__scope-label" id="settings-scope-label">
          {t('settingsPanel.navigation.scopeLabel')}
        </span>
        <CoveSelect
          id="settings-panel-scope-selector"
          testId="settings-panel-scope-selector"
          ariaLabel={t('settingsPanel.navigation.scopeLabel')}
          value={isProject ? activePageId : 'app'}
          options={scopeOptions}
          onChange={value =>
            onSelectPage(
              value === 'app' ? lastApplicationPageRef.current : (value as SettingsPageId),
            )
          }
        />
      </div>
      {!isProject ? (
        <div className="settings-panel__mobile-nav">
          <CoveSelect
            id="settings-panel-page-selector"
            testId="settings-panel-page-selector"
            ariaLabel={t('settingsPanel.nav.pageSelectorLabel')}
            value={resolvedActivePage.canonicalPageId}
            options={pageOptions}
            onChange={value => onSelectPage(value as SettingsPageId)}
          />
        </div>
      ) : null}
      <nav
        className="settings-panel__nav-sections"
        aria-label={
          isProject ? t('settingsPanel.nav.projects') : t('settingsPanel.nav.sectionsLabel')
        }
      >
        {isProject ? (
          <SettingsPanelNavButton
            isActive
            icon={<FolderKanban size={16} aria-hidden="true" />}
            label={t('settingsPanel.navigation.projectSettings')}
            onClick={() => onSelectPage(activePageId)}
          />
        ) : (
          SETTINGS_PRIMARY_PAGE_IDS.map(renderPage)
        )}
      </nav>
      {!isProject ? (
        <nav className="settings-panel__nav-footer" aria-label={t('settingsPanel.nav.advanced')}>
          {renderPage('advanced')}
        </nav>
      ) : null}
    </aside>
  )
}
