import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'

export function ProjectMountManagerLocalSection({
  t,
  isBusy,
  canBrowseLocal,
  localRootPath,
  localMountName,
  onChangeLocalRootPath,
  onChangeLocalMountName,
  onBrowseLocal,
  onCreateLocal,
}: {
  t: TranslateFn
  isBusy: boolean
  canBrowseLocal: boolean
  localRootPath: string
  localMountName: string
  onChangeLocalRootPath: (value: string) => void
  onChangeLocalMountName: (value: string) => void
  onBrowseLocal: () => void
  onCreateLocal: () => void
}): React.JSX.Element {
  return (
    <div className="cove-window__field-row">
      <label>{t('projectMountManager.addLocalLabel')}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        <div style={{ display: 'flex', gap: 10, width: '100%', alignItems: 'center' }}>
          <input
            className="cove-field"
            type="text"
            value={localRootPath}
            onChange={event => onChangeLocalRootPath(event.target.value)}
            disabled={isBusy}
            placeholder={t('projectMountManager.localRootPlaceholder')}
            data-testid="workspace-project-mount-local-root"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            disabled={isBusy || !canBrowseLocal}
            data-testid="workspace-project-mount-browse-local"
            style={{ flexShrink: 0 }}
            onClick={onBrowseLocal}
          >
            {t('projectMountManager.browseLocalAction')}
          </button>
        </div>
        <input
          className="cove-field"
          type="text"
          value={localMountName}
          onChange={event => onChangeLocalMountName(event.target.value)}
          disabled={isBusy}
          placeholder={t('projectMountManager.localNamePlaceholder')}
          data-testid="workspace-project-mount-local-name"
        />
        <button
          type="button"
          className="cove-window__action cove-window__action--primary"
          disabled={isBusy || localRootPath.trim().length === 0}
          data-testid="workspace-project-mount-add-local"
          onClick={onCreateLocal}
        >
          {t('common.add')}
        </button>
      </div>
    </div>
  )
}