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
    <div className="cove-window__section-card cove-window__section-card--subtle">
      <div className="cove-window__section-card-heading">
        <strong>{t('addProjectWizard.mountsLabel')}</strong>
      </div>
      <div className="cove-window__stack cove-window__stack--tight">
        {rows.length === 0 ? (
          <div className="cove-window__field-help">{t('addProjectWizard.mountsEmpty')}</div>
        ) : (
          rows.map(row => {
            const isDefault = row.kind === 'default'
            const mount = row.mount
            return (
              <div
                key={row.kind === 'default' ? 'default' : row.mount.id}
                className="cove-window__mount-row"
              >
                <div className="cove-window__mount-row-main">
                  <div className="cove-window__mount-row-title">
                    <strong>{mount.name ?? t('addProjectWizard.mountUnnamed')}</strong>
                    {isDefault ? (
                      <span className="cove-window__badge cove-window__badge--success">
                        {t('addProjectWizard.defaultMountBadge')}
                      </span>
                    ) : null}
                  </div>
                  <div className="cove-window__mount-row-meta">
                    {endpointLabelById.get(mount.endpointId) ?? mount.endpointId} · {mount.rootPath}
                  </div>
                </div>
                {row.kind === 'extra' ? (
                  <div className="cove-window__mount-row-actions">
                    <button
                      type="button"
                      className="cove-window__action cove-window__action--danger"
                      disabled={isBusy}
                      onClick={() => onRemoveExtraMount(row.mount.id)}
                      data-testid={`workspace-project-create-mount-remove-${row.mount.id}`}
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
