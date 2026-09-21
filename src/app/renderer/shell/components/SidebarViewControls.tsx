import React from 'react'
import { Focus } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { SidebarViewMode } from '@contexts/settings/domain/sidebarViewSettings'

const MODES: SidebarViewMode[] = ['focus', 'normal', 'all']

export function SidebarViewControls({
  mode = 'normal',
  hiddenWaitingCount,
  onChange,
}: {
  mode?: SidebarViewMode
  hiddenWaitingCount: number
  onChange: (mode: SidebarViewMode) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const currentIndex = Math.max(0, MODES.indexOf(mode))
  const nextMode = MODES[(currentIndex + 1) % MODES.length]
  const modeLabel = t(`sidebar.viewMode.${mode}`)
  const nextModeLabel = t(`sidebar.viewMode.${nextMode}`)

  return (
    <button
      type="button"
      className="workspace-sidebar__more workspace-sidebar__filter workspace-sidebar__view-mode"
      data-testid="workspace-sidebar-view-mode"
      data-mode={mode}
      aria-label={`${t('sidebar.viewMode.label')}: ${modeLabel}`}
      title={`${modeLabel} · ${t('sidebar.viewMode.next', { mode: nextModeLabel })}`}
      aria-live="polite"
      onClick={() => onChange(nextMode)}
    >
      <Focus size={14} aria-hidden="true" />
      <span className="workspace-sidebar__view-mode-label">{modeLabel}</span>
      {hiddenWaitingCount > 0 ? (
        <span
          className="workspace-sidebar__filter-attention"
          aria-label={t('sidebar.hiddenAttention', { count: hiddenWaitingCount })}
        />
      ) : null}
    </button>
  )
}
