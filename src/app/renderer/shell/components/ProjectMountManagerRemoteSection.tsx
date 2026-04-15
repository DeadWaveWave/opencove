import React, { useState } from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import type { WorkerEndpointDto } from '@shared/contracts/dto'
import { basename } from '../utils/pathHelpers'
import { RemoteDirectoryPickerWindow } from './RemoteDirectoryPickerWindow'

export function ProjectMountManagerRemoteSection({
  t,
  isBusy,
  remoteEndpoints,
  endpointLabelById,
  remoteEndpointId,
  remoteRootPath,
  remoteMountName,
  canCreateRemote,
  onChangeRemoteEndpointId,
  onChangeRemoteRootPath,
  onChangeRemoteMountName,
  onCreateRemoteMount,
  onRefresh,
  onRequestOpenEndpoints,
}: {
  t: TranslateFn
  isBusy: boolean
  remoteEndpoints: WorkerEndpointDto[]
  endpointLabelById: ReadonlyMap<string, string>
  remoteEndpointId: string
  remoteRootPath: string
  remoteMountName: string
  canCreateRemote: boolean
  onChangeRemoteEndpointId: (value: string) => void
  onChangeRemoteRootPath: (value: string) => void
  onChangeRemoteMountName: (value: string) => void
  onCreateRemoteMount: () => void
  onRefresh: () => void
  onRequestOpenEndpoints: () => void
}): React.JSX.Element {
  const [remotePickerState, setRemotePickerState] = useState<{
    endpointId: string
    endpointLabel: string
    initialPath: string | null
  } | null>(null)

  return (
    <>
      <div className="cove-window__field-row">
        <label>{t('projectMountManager.addRemoteLabel')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {remoteEndpoints.length === 0 ? (
            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              disabled={isBusy}
              data-testid="workspace-project-mount-open-endpoints"
              onClick={() => {
                onRequestOpenEndpoints()
              }}
            >
              {t('projectMountManager.openEndpointsAction')}
            </button>
          ) : (
            <>
              <CoveSelect
                testId="workspace-project-mount-remote-endpoint"
                value={remoteEndpointId}
                options={remoteEndpoints.map(endpoint => ({
                  value: endpoint.endpointId,
                  label: endpoint.displayName,
                }))}
                disabled={isBusy}
                onChange={nextValue => onChangeRemoteEndpointId(nextValue)}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  className="cove-field"
                  type="text"
                  value={remoteRootPath}
                  onChange={event => onChangeRemoteRootPath(event.target.value)}
                  disabled={isBusy}
                  placeholder={t('projectMountManager.remoteRootPlaceholder')}
                  data-testid="workspace-project-mount-remote-root"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  disabled={isBusy || remoteEndpointId.trim().length === 0}
                  data-testid="workspace-project-mount-remote-browse"
                  style={{ flexShrink: 0 }}
                  onClick={() => {
                    const endpointId = remoteEndpointId.trim()
                    if (endpointId.length === 0) {
                      return
                    }

                    setRemotePickerState({
                      endpointId,
                      endpointLabel: endpointLabelById.get(endpointId) ?? endpointId,
                      initialPath: remoteRootPath.trim().length > 0 ? remoteRootPath.trim() : null,
                    })
                  }}
                >
                  {t('projectMountManager.browseLocalAction')}
                </button>
              </div>
              <input
                className="cove-field"
                type="text"
                value={remoteMountName}
                onChange={event => onChangeRemoteMountName(event.target.value)}
                disabled={isBusy}
                placeholder={t('projectMountManager.remoteNamePlaceholder')}
                data-testid="workspace-project-mount-remote-name"
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="cove-window__action cove-window__action--primary"
                  disabled={isBusy || !canCreateRemote}
                  data-testid="workspace-project-mount-add-remote"
                  onClick={() => {
                    onCreateRemoteMount()
                  }}
                >
                  {t('common.add')}
                </button>
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  disabled={isBusy}
                  data-testid="workspace-project-mount-refresh"
                  onClick={() => {
                    onRefresh()
                  }}
                >
                  {t('common.refresh')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <RemoteDirectoryPickerWindow
        isOpen={remotePickerState !== null}
        endpointId={remotePickerState?.endpointId ?? ''}
        endpointLabel={remotePickerState?.endpointLabel ?? ''}
        initialPath={remotePickerState?.initialPath ?? null}
        onCancel={() => {
          setRemotePickerState(null)
        }}
        onSelect={path => {
          setRemotePickerState(null)
          onChangeRemoteRootPath(path)
          if (remoteMountName.trim().length === 0) {
            onChangeRemoteMountName(basename(path))
          }
        }}
      />
    </>
  )
}
