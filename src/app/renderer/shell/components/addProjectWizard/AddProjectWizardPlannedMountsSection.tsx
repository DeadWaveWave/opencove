import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { DraftMount } from './helpers'

export type PlannedMount = {
  endpointId: string
  rootPath: string
  name: string | null
}

export function AddProjectWizardPlannedMountsSection({
  t,
  defaultMount,
  extraMounts,
  endpointLabelById,
  isBusy,
  onRemoveExtraMount,
}: {
  t: TranslateFn
  defaultMount: PlannedMount | null
  extraMounts: DraftMount[]
  endpointLabelById: ReadonlyMap<string, string>
  isBusy: boolean
  onRemoveExtraMount: (draftId: string) => void
}): React.JSX.Element {
  const rows: Array<
    { kind: 'default'; mount: PlannedMount } | { kind: 'extra'; mount: DraftMount }
  > = []

  if (defaultMount) {
    rows.push({ kind: 'default', mount: defaultMount })
  }

  extraMounts.forEach(mount => {
    rows.push({ kind: 'extra', mount })
  })

  return (
    <div className="cove-window__field-row">
      <label>{t('addProjectWizard.mountsLabel')}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        {rows.length === 0 ? (
          <div style={{ color: 'var(--cove-text-faint)', fontSize: 12 }}>
            {t('addProjectWizard.mountsEmpty')}
          </div>
        ) : (
          rows.map(row => {
            const isDefault = row.kind === 'default'
            const mount = row.mount
            return (
              <div
                key={row.kind === 'default' ? 'default' : row.mount.id}
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
                      {mount.name ?? t('addProjectWizard.mountUnnamed')}
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
                        {t('addProjectWizard.defaultMountBadge')}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--cove-text-muted)' }}>
                    {endpointLabelById.get(mount.endpointId) ?? mount.endpointId} · {mount.rootPath}
                  </div>
                </div>
                {row.kind === 'extra' ? (
                  <button
                    type="button"
                    className="cove-window__action cove-window__action--danger"
                    disabled={isBusy}
                    onClick={() => onRemoveExtraMount(row.mount.id)}
                    data-testid={`workspace-project-create-mount-remove-${row.mount.id}`}
                  >
                    {t('common.remove')}
                  </button>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
