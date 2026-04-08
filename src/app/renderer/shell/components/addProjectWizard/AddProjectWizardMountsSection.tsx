import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { DraftMount } from './helpers'

export function AddProjectWizardMountsSection({
  t,
  draftMounts,
  endpointLabelById,
  isBusy,
  onRemoveMountDraft,
}: {
  t: TranslateFn
  draftMounts: DraftMount[]
  endpointLabelById: ReadonlyMap<string, string>
  isBusy: boolean
  onRemoveMountDraft: (draftId: string) => void
}): React.JSX.Element {
  return (
    <div className="cove-window__field-row">
      <label>{t('addProjectWizard.mountsLabel')}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        {draftMounts.length === 0 ? (
          <div style={{ color: 'var(--cove-text-faint)', fontSize: 12 }}>
            {t('addProjectWizard.mountsEmpty')}
          </div>
        ) : (
          draftMounts.map(mount => (
            <div
              key={mount.id}
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
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--cove-text)' }}>
                  {mount.name ?? t('addProjectWizard.mountUnnamed')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--cove-text-muted)' }}>
                  {endpointLabelById.get(mount.endpointId) ?? mount.endpointId} · {mount.rootPath}
                </div>
              </div>
              <button
                type="button"
                className="cove-window__action cove-window__action--danger"
                disabled={isBusy}
                onClick={() => onRemoveMountDraft(mount.id)}
                data-testid={`workspace-project-create-mount-remove-${mount.id}`}
              >
                {t('common.remove')}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
