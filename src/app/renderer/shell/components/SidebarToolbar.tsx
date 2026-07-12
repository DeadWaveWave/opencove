import React from 'react'
import { Pin, Plus } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function SidebarToolbar({
  isPinned,
  showAddProject,
  onTogglePinned,
  onAddProject,
}: {
  isPinned: boolean
  showAddProject: boolean
  onTogglePinned: () => void
  onAddProject: (anchor?: { x: number; y: number }) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const pinLabel = isPinned ? t('sidebar.unpin') : t('sidebar.pin')

  return (
    <div className="workspace-sidebar__toolbar">
      <button
        type="button"
        className={`workspace-sidebar__toolbar-button workspace-sidebar__toolbar-button--pin${isPinned ? ' workspace-sidebar__toolbar-button--active' : ''}`}
        data-testid="workspace-sidebar-pin"
        aria-label={pinLabel}
        aria-pressed={isPinned}
        title={pinLabel}
        onClick={onTogglePinned}
      >
        <Pin aria-hidden="true" />
      </button>
      {showAddProject ? (
        <button
          type="button"
          className="workspace-sidebar__toolbar-button"
          data-testid="workspace-sidebar-add-project"
          aria-label={t('sidebar.addProject')}
          title={t('sidebar.addProject')}
          onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect()
            onAddProject({
              x: Math.round(rect.left),
              y: Math.round(rect.bottom + 6),
            })
          }}
        >
          <Plus aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
