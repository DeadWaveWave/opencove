import React from 'react'
import { FolderX } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

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
    <div
      className="workspace-context-menu workspace-project-context-menu"
      style={{
        top: y,
        left: x,
      }}
      onMouseDown={event => {
        event.stopPropagation()
      }}
      onClick={event => {
        event.stopPropagation()
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
    </div>
  )
}
