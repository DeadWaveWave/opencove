import React from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { IconButton } from '@app/renderer/components/ui/IconButton'

/** The rail's add-project button, and the close button of the mobile drawer. */
export function SidebarToolbar({
  isMobile = false,
  onAddProject,
  onClose,
}: {
  isMobile?: boolean
  onAddProject: (anchor?: { x: number; y: number }) => void
  onClose?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="workspace-sidebar__toolbar">
      {isMobile ? (
        <IconButton
          className="workspace-sidebar__toolbar-button"
          data-testid="workspace-sidebar-close"
          label={t('common.close')}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </IconButton>
      ) : null}
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
