import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import type { DraftMount } from './helpers'
import type { PlannedMount } from './AddProjectWizardPlannedMountsSection'
import { AddProjectWizardPlannedMountsSection } from './AddProjectWizardPlannedMountsSection'

export function AddProjectWizardAdvancedSection({
  t,
  isBusy,
  canBrowseLocal,
  showRemote,
  isAdvancedOpen,
  defaultMountPreview,
  extraMounts,
  endpointLabelById,
  remoteEndpointsCount,
  endpointOptions,
  extraLocalRootPath,
  extraLocalMountName,
  extraRemoteEndpointId,
  extraRemoteRootPath,
  extraRemoteMountName,
  canCreateExtraRemote,
  onToggleAdvanced,
  onChangeExtraLocalRootPath,
  onChangeExtraLocalMountName,
  onBrowseExtraLocalRootPath,
  onAddExtraLocalMount,
  onChangeExtraRemoteEndpointId,
  onChangeExtraRemoteRootPath,
  onChangeExtraRemoteMountName,
  onBrowseExtraRemoteRootPath,
  onAddExtraRemoteMount,
  onRemoveExtraMount,
  onReloadEndpoints,
  onRequestOpenEndpoints,
}: {
  t: TranslateFn
  isBusy: boolean
  canBrowseLocal: boolean
  showRemote: boolean
  isAdvancedOpen: boolean
  defaultMountPreview: PlannedMount | null
  extraMounts: DraftMount[]
  endpointLabelById: ReadonlyMap<string, string>
  remoteEndpointsCount: number
  endpointOptions: Array<{ value: string; label: string }>
  extraLocalRootPath: string
  extraLocalMountName: string
  extraRemoteEndpointId: string
  extraRemoteRootPath: string
  extraRemoteMountName: string
  canCreateExtraRemote: boolean
  onToggleAdvanced: () => void
  onChangeExtraLocalRootPath: (value: string) => void
  onChangeExtraLocalMountName: (value: string) => void
  onBrowseExtraLocalRootPath: () => void
  onAddExtraLocalMount: () => void
  onChangeExtraRemoteEndpointId: (value: string) => void
  onChangeExtraRemoteRootPath: (value: string) => void
  onChangeExtraRemoteMountName: (value: string) => void
  onBrowseExtraRemoteRootPath: () => void
  onAddExtraRemoteMount: () => void
  onRemoveExtraMount: (draftId: string) => void
  onReloadEndpoints: () => void
  onRequestOpenEndpoints: () => void
}): React.JSX.Element {
  return (
    <div className="cove-window__field-row">
      <div className="cove-window__label-row">
        <label>{t('addProjectWizard.advancedLabel')}</label>
        <button
          type="button"
          className="cove-window__action cove-window__action--ghost"
          disabled={isBusy}
          data-testid="workspace-project-create-advanced-toggle"
          onClick={() => onToggleAdvanced()}
        >
          {isAdvancedOpen ? t('addProjectWizard.advancedHide') : t('addProjectWizard.advancedShow')}
        </button>
      </div>

      {isAdvancedOpen ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
          <AddProjectWizardPlannedMountsSection
            t={t}
            defaultMount={defaultMountPreview}
            extraMounts={extraMounts}
            endpointLabelById={endpointLabelById}
            isBusy={isBusy}
            onRemoveExtraMount={onRemoveExtraMount}
          />

          <div className="cove-window__field-row">
            <label>{t('addProjectWizard.addExtraLocalLabel')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  className="cove-field"
                  type="text"
                  value={extraLocalRootPath}
                  onChange={event => onChangeExtraLocalRootPath(event.target.value)}
                  disabled={isBusy}
                  placeholder={t('addProjectWizard.localPathPlaceholder')}
                  data-testid="workspace-project-create-extra-local-root"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  disabled={isBusy || !canBrowseLocal}
                  onClick={() => {
                    onBrowseExtraLocalRootPath()
                  }}
                  data-testid="workspace-project-create-extra-local-browse"
                  style={{ flexShrink: 0 }}
                >
                  {t('addProjectWizard.browse')}
                </button>
              </div>
              <input
                className="cove-field"
                type="text"
                value={extraLocalMountName}
                onChange={event => onChangeExtraLocalMountName(event.target.value)}
                disabled={isBusy}
                placeholder={t('addProjectWizard.localNamePlaceholder')}
                data-testid="workspace-project-create-extra-local-name"
              />
              <button
                type="button"
                className="cove-window__action cove-window__action--primary"
                disabled={isBusy || extraLocalRootPath.trim().length === 0}
                onClick={() => onAddExtraLocalMount()}
                data-testid="workspace-project-create-extra-local-add"
              >
                {t('common.add')}
              </button>
            </div>
          </div>

          <div className="cove-window__field-row">
            <label>{t('addProjectWizard.addExtraRemoteLabel')}</label>
            {showRemote ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                {remoteEndpointsCount === 0 ? (
                  <button
                    type="button"
                    className="cove-window__action cove-window__action--ghost"
                    disabled={isBusy}
                    data-testid="workspace-project-create-advanced-open-endpoints"
                    onClick={() => {
                      onRequestOpenEndpoints()
                    }}
                  >
                    {t('addProjectWizard.openEndpointsAction')}
                  </button>
                ) : (
                  <>
                    <CoveSelect
                      testId="workspace-project-create-extra-remote-endpoint"
                      value={extraRemoteEndpointId}
                      options={endpointOptions}
                      disabled={isBusy || endpointOptions.length === 0}
                      onChange={nextValue => onChangeExtraRemoteEndpointId(nextValue)}
                    />
                    <div style={{ display: 'flex', gap: 10 }}>
                      <input
                        className="cove-field"
                        type="text"
                        value={extraRemoteRootPath}
                        onChange={event => onChangeExtraRemoteRootPath(event.target.value)}
                        disabled={isBusy || endpointOptions.length === 0}
                        placeholder={t('addProjectWizard.remotePathPlaceholder')}
                        data-testid="workspace-project-create-extra-remote-root"
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="cove-window__action cove-window__action--ghost"
                        disabled={isBusy || extraRemoteEndpointId.trim().length === 0}
                        data-testid="workspace-project-create-extra-remote-browse"
                        style={{ flexShrink: 0 }}
                        onClick={() => {
                          onBrowseExtraRemoteRootPath()
                        }}
                      >
                        {t('addProjectWizard.browse')}
                      </button>
                    </div>
                    <input
                      className="cove-field"
                      type="text"
                      value={extraRemoteMountName}
                      onChange={event => onChangeExtraRemoteMountName(event.target.value)}
                      disabled={isBusy || endpointOptions.length === 0}
                      placeholder={t('addProjectWizard.remoteNamePlaceholder')}
                      data-testid="workspace-project-create-extra-remote-name"
                    />
                    <button
                      type="button"
                      className="cove-window__action cove-window__action--primary"
                      disabled={isBusy || !canCreateExtraRemote}
                      onClick={() => onAddExtraRemoteMount()}
                      data-testid="workspace-project-create-extra-remote-add"
                    >
                      {t('common.add')}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>

          {showRemote ? (
            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              disabled={isBusy}
              data-testid="workspace-project-create-refresh-endpoints"
              onClick={() => {
                onReloadEndpoints()
              }}
            >
              {t('common.refresh')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
