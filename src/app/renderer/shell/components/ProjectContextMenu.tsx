import React from 'react'
import { FolderX } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'

export function ProjectContextMenu({
  workspaceId,
  x,
  y,
  onRequestRemove,
}: {
  workspaceId: string
  x: number
  y: number
  onRequestRemove: (workspaceId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ViewportMenuSurface
      open={true}
      className="workspace-context-menu workspace-project-context-menu"
      placement={{
        type: 'point',
        point: { x, y },
        estimatedSize: {
          width: 188,
          height: 56,
        },
      }}
    >
      <button
        type="button"
        data-testid={`workspace-project-remove-${workspaceId}`}
        onClick={() => {
          onRequestRemove(workspaceId)
        }}
      >
        <FolderX className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('projectContextMenu.removeProject')}
        </span>
      </button>
    </ViewportMenuSurface>
  )
}
