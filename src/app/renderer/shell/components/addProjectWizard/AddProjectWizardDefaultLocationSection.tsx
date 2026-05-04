import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

export type DefaultLocationKind = 'local' | 'remote'

export function AddProjectWizardDefaultLocationSection({
  t,
  isBusy,
  canBrowseLocal,
  showRemote,
  remoteEndpointsCount,
  endpointOptions,
  defaultLocationKind,
  defaultLocalRootPath,
  defaultRemoteEndpointId,
  defaultRemoteRootPath,
  remoteStatusSlot,
  onChangeDefaultLocationKind,
  onChangeDefaultLocalRootPath,
  onBrowseDefaultLocalRootPath,
  onChangeDefaultRemoteEndpointId,
  onChangeDefaultRemoteRootPath,
  onBrowseDefaultRemoteRootPath,
  onRequestOpenEndpoints,
}: {
  t: TranslateFn
  isBusy: boolean
  canBrowseLocal: boolean
  showRemote: boolean
  remoteEndpointsCount: number
  endpointOptions: Array<{ value: string; label: string }>
  defaultLocationKind: DefaultLocationKind
  defaultLocalRootPath: string
  defaultRemoteEndpointId: string
  defaultRemoteRootPath: string
  remoteStatusSlot?: React.ReactNode
  onChangeDefaultLocationKind: (kind: DefaultLocationKind) => void
  onChangeDefaultLocalRootPath: (value: string) => void
  onBrowseDefaultLocalRootPath: () => void
  onChangeDefaultRemoteEndpointId: (value: string) => void
  onChangeDefaultRemoteRootPath: (value: string) => void
  onBrowseDefaultRemoteRootPath: () => void
  onRequestOpenEndpoints: () => void
}): React.JSX.Element {
  const effectiveDefaultLocationKind: DefaultLocationKind = showRemote
    ? defaultLocationKind
    : 'local'

  return (
    <div className="cove-window__field-row">
      <div className="cove-window__label-row">
        <label>{t('addProjectWizard.defaultLocationLabel')}</label>
        {showRemote ? (
          <div
            className="cove-window__segmented"
            data-testid="workspace-project-create-default-location"
          >
            <button
              type="button"
              className={`cove-window__segment${defaultLocationKind === 'local' ? ' cove-window__segment--selected' : ''}`}
              disabled={isBusy}
              onClick={() => onChangeDefaultLocationKind('local')}
              data-testid="workspace-project-create-default-location-local"
            >
              {t('addProjectWizard.defaultLocationLocal')}
            </button>
            <button
              type="button"
              className={`cove-window__segment${defaultLocationKind === 'remote' ? ' cove-window__segment--selected' : ''}`}
              disabled={isBusy}
              onClick={() => onChangeDefaultLocationKind('remote')}
              data-testid="workspace-project-create-default-location-remote"
            >
              {t('addProjectWizard.defaultLocationRemote')}
            </button>
          </div>
        ) : null}
      </div>

      {effectiveDefaultLocationKind === 'local' ? (
        <div className="cove-window__section-card cove-window__section-card--subtle">
          <div className="cove-window__path-row cove-window__path-row--single-action">
            <input
              className="cove-field"
              type="text"
              value={defaultLocalRootPath}
              onChange={event => onChangeDefaultLocalRootPath(event.target.value)}
              disabled={isBusy}
              placeholder={t('addProjectWizard.localPathPlaceholder')}
              data-testid="workspace-project-create-default-local-root"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              disabled={isBusy || !canBrowseLocal}
              onClick={() => onBrowseDefaultLocalRootPath()}
              data-testid="workspace-project-create-default-local-browse"
            >
              {t('addProjectWizard.browse')}
            </button>
          </div>
        </div>
      ) : (
        <div className="cove-window__section-card">
          {remoteEndpointsCount === 0 ? (
            <div className="cove-window__empty-card">
              <div className="cove-window__section-card-heading">
                <strong>{t('addProjectWizard.noRemoteWorkersTitle')}</strong>
                <span>{t('addProjectWizard.noRemoteWorkersHint')}</span>
              </div>
              <button
                type="button"
                className="cove-window__action cove-window__action--primary"
                disabled={isBusy}
                data-testid="workspace-project-create-open-endpoints"
                onClick={() => {
                  onRequestOpenEndpoints()
                }}
              >
                {t('addProjectWizard.openEndpointsAction')}
              </button>
            </div>
          ) : (
            <div className="cove-window__stack cove-window__stack--tight">
              <CoveSelect
                testId="workspace-project-create-default-remote-endpoint"
                value={defaultRemoteEndpointId}
                options={endpointOptions}
                disabled={isBusy || endpointOptions.length === 0}
                showTriggerBadge={false}
                onChange={nextValue => onChangeDefaultRemoteEndpointId(nextValue)}
              />
              {remoteStatusSlot ?? null}
              <div className="cove-window__path-row cove-window__path-row--single-action">
                <input
                  className="cove-field"
                  type="text"
                  value={defaultRemoteRootPath}
                  onChange={event => onChangeDefaultRemoteRootPath(event.target.value)}
                  disabled={isBusy}
                  placeholder={t('addProjectWizard.remotePathPlaceholder')}
                  data-testid="workspace-project-create-default-remote-root"
                />
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  disabled={isBusy || defaultRemoteEndpointId.trim().length === 0}
                  data-testid="workspace-project-create-default-remote-browse"
                  onClick={() => {
                    onBrowseDefaultRemoteRootPath()
                  }}
                >
                  {t('addProjectWizard.browse')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
