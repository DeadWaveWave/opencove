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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        border: '1px solid var(--cove-border-subtle)',
        background: 'var(--cove-field)',
        borderRadius: 12,
        padding: '10px 12px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--cove-text)' }}>
            {mount.name}
          </div>
          {isDefault ? (
            <span
              style={{
                borderRadius: 999,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1.2,
                background: 'rgba(42, 255, 140, 0.18)',
                border: '1px solid rgba(42, 255, 140, 0.35)',
                color: 'var(--cove-text)',
              }}
            >
              {t('projectMountManager.defaultMountBadge')}
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: 'var(--cove-text-muted)' }}>
          {endpointLabel} · {mount.rootPath}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
