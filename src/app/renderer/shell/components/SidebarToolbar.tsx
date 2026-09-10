import React from 'react'
import { Pin, Plus, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { IconButton } from '@app/renderer/components/ui/IconButton'

export function SidebarToolbar({
  isPinned,
  isMobile = false,
  onTogglePinned,
  onAddProject,
  onClose,
}: {
  isPinned: boolean
  isMobile?: boolean
  onTogglePinned: () => void
  onAddProject: (anchor?: { x: number; y: number }) => void
  onClose?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const pinLabel = isPinned ? t('sidebar.unpin') : t('sidebar.pin')

  return (
    <div className="workspace-sidebar__toolbar">
      <IconButton
        className={`workspace-sidebar__toolbar-button workspace-sidebar__toolbar-button--pin${isPinned ? ' workspace-sidebar__toolbar-button--active' : ''}`}
        data-testid={isMobile ? 'workspace-sidebar-close' : 'workspace-sidebar-pin'}
        label={isMobile ? t('common.close') : pinLabel}
        aria-pressed={isMobile ? undefined : isPinned}
        title={isMobile ? t('common.close') : pinLabel}
        onClick={isMobile ? onClose : onTogglePinned}
      >
        {isMobile ? <X aria-hidden="true" /> : <Pin aria-hidden="true" />}
      </IconButton>
      <IconButton
        className="workspace-sidebar__toolbar-button"
        data-testid="workspace-sidebar-add-project"
        label={t('sidebar.addProject')}
        title={t('sidebar.addProject')}
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          onAddProject({
            x: Math.round(rect.right + 6),
            y: Math.round(rect.top),
          })
        }}
      >
        <Plus aria-hidden="true" />
      </IconButton>
    </div>
  )
}
