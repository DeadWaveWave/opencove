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

      {effectiveDefaultLocationKind === 'local' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <div style={{ display: 'flex', gap: 10, width: '100%', alignItems: 'center' }}>
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
              style={{ flexShrink: 0 }}
            >
              {t('addProjectWizard.browse')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {remoteEndpointsCount === 0 ? (
            <div
              style={{
                border: '1px solid var(--cove-border-subtle)',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {t('addProjectWizard.noRemoteWorkersTitle')}
                </div>
                <div style={{ color: 'var(--cove-text-muted)', fontSize: 12 }}>
                  {t('addProjectWizard.noRemoteWorkersHint')}
                </div>
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
            <>
              <CoveSelect
                testId="workspace-project-create-default-remote-endpoint"
                value={defaultRemoteEndpointId}
                options={endpointOptions}
                disabled={isBusy || endpointOptions.length === 0}
                onChange={nextValue => onChangeDefaultRemoteEndpointId(nextValue)}
              />
              <div style={{ display: 'flex', gap: 10, width: '100%', alignItems: 'center' }}>
                <input
                  className="cove-field"
                  type="text"
                  value={defaultRemoteRootPath}
                  onChange={event => onChangeDefaultRemoteRootPath(event.target.value)}
                  disabled={isBusy}
                  placeholder={t('addProjectWizard.remotePathPlaceholder')}
                  data-testid="workspace-project-create-default-remote-root"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  disabled={isBusy || defaultRemoteEndpointId.trim().length === 0}
                  data-testid="workspace-project-create-default-remote-browse"
                  style={{ flexShrink: 0 }}
                  onClick={() => {
                    onBrowseDefaultRemoteRootPath()
                  }}
                >
                  {t('addProjectWizard.browse')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
