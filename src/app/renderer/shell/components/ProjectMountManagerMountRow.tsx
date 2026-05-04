import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { MountDto } from '@shared/contracts/dto'

export function ProjectMountManagerMountRow({
  mount,
  endpointLabel,
  isDefault,
  isBusy,
  actionsDisabled = false,
  onPromote,
  onRemove,
}: {
  mount: MountDto
  endpointLabel: string
  isDefault: boolean
  isBusy: boolean
  actionsDisabled?: boolean
  onPromote: (mountId: string) => void
  onRemove: (mountId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const controlsDisabled = isBusy || actionsDisabled

  return (
    <div className="cove-window__mount-row">
      <div className="cove-window__mount-row-main">
        <div className="cove-window__mount-row-title">
          <strong>{mount.name}</strong>
          {isDefault ? (
            <span className="cove-window__badge cove-window__badge--success">
              {t('projectMountManager.defaultMountBadge')}
            </span>
          ) : null}
        </div>
        <div className="cove-window__mount-row-meta">
          {endpointLabel} · {mount.rootPath}
        </div>
      </div>
      <div className="cove-window__mount-row-actions">
        {isDefault ? null : (
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            disabled={controlsDisabled}
            data-testid={`workspace-project-mount-promote-${mount.mountId}`}
            onClick={() => onPromote(mount.mountId)}
          >
            {t('projectMountManager.makeDefaultAction')}
          </button>
        )}
        <button
          type="button"
          className="cove-window__action cove-window__action--danger"
          disabled={controlsDisabled}
          data-testid={`workspace-project-mount-remove-${mount.mountId}`}
          onClick={() => onRemove(mount.mountId)}
        >
          {t('common.remove')}
        </button>
      </div>
    </div>
  )
}