import React from 'react'
import { FolderOpen, FolderX, HardDrive } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'

export function ProjectContextMenu({
  workspaceId,
  x,
  y,
  onRequestManageMounts,
  onRequestOpenInFileManager,
  onRequestRemove,
}: {
  workspaceId: string
  x: number
  y: number
  onRequestManageMounts: (workspaceId: string) => void
  onRequestOpenInFileManager: (workspaceId: string) => void
  onRequestRemove: (workspaceId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const runtime = window.opencoveApi?.meta?.runtime
  const platform = window.opencoveApi?.meta?.platform
  const canOpenInFileManager = runtime === 'electron'
  const openInFileManagerLabel =
    platform === 'win32'
      ? t('projectContextMenu.openInExplorer')
      : platform === 'darwin'
        ? t('projectContextMenu.openInFinder')
        : t('projectContextMenu.openInFileManager')
  const estimatedWidth = canOpenInFileManager ? 236 : 188
  const estimatedHeight = canOpenInFileManager ? 136 : 96

  return (
    <ViewportMenuSurface
      open={true}
      className="workspace-context-menu workspace-project-context-menu"
      placement={{
        type: 'point',
        point: { x, y },
        estimatedSize: {
          width: estimatedWidth,
          height: estimatedHeight,
        },
      }}
    >
      <button
        type="button"
        data-testid={`workspace-project-manage-mounts-${workspaceId}`}
        onClick={() => {
          onRequestManageMounts(workspaceId)
        }}
      >
        <HardDrive className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('projectContextMenu.manageMounts')}
        </span>
      </button>
      {canOpenInFileManager ? (
        <button
          type="button"
          data-testid={`workspace-project-open-in-file-manager-${workspaceId}`}
          onClick={() => {
            onRequestOpenInFileManager(workspaceId)
          }}
        >
          <FolderOpen className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">{openInFileManagerLabel}</span>
        </button>
      ) : null}
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
