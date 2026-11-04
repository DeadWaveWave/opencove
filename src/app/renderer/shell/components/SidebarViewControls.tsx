import React from 'react'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import { useTranslation } from '@app/renderer/i18n'
import type { SidebarViewMode } from '@contexts/settings/domain/sidebarViewSettings'

const MODES: SidebarViewMode[] = ['focus', 'normal', 'all']

/**
 * Focus / Normal / All as one segmented control under the project name (Tide sidebar). A dot
 * marks the control while the current mode hides agents that are waiting for you.
 */
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
  return (
    <div className="workspace-sidebar__view-mode">
      <SegmentedControl
        className="workspace-sidebar__view-mode-control"
        testId="workspace-sidebar-view-mode"
        label={t('sidebar.viewMode.label')}
        value={mode}
        onValueChange={onChange}
        options={MODES.map(option => ({
          value: option,
          label: t(`sidebar.viewMode.${option}`),
          testId: `workspace-sidebar-view-mode-${option}`,
        }))}
      />
      {hiddenWaitingCount > 0 ? (
        <span
          className="workspace-sidebar__filter-attention"
          role="status"
          aria-label={t('sidebar.hiddenAttention', { count: hiddenWaitingCount })}
        />
      ) : null}
    </div>
  )
}
