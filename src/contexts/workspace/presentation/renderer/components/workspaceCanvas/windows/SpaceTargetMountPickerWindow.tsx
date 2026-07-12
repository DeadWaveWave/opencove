import React, { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AnchoredOperationPopover } from '@app/renderer/components/AnchoredOperationPopover'
import type { ListWorkerEndpointsResult } from '@shared/contracts/dto'
import type { SpaceTargetMountPickerState } from '../types'

export function SpaceTargetMountPickerWindow({
  picker,
  setPicker,
  onCancel,
  onConfirm,
}: {
  picker: SpaceTargetMountPickerState | null
  setPicker: Dispatch<SetStateAction<SpaceTargetMountPickerState | null>>
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [endpointLabelById, setEndpointLabelById] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!picker) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const result = await window.opencoveApi.controlSurface.invoke<ListWorkerEndpointsResult>({
          kind: 'query',
          id: 'endpoint.list',
          payload: null,
        })
        if (cancelled) {
          return
        }

        const next: Record<string, string> = {}
        for (const endpoint of result.endpoints) {
          next[endpoint.endpointId] = endpoint.displayName
        }
        setEndpointLabelById(next)
      } catch {
        // ignore
      }
    })()

    return () => {
      cancelled = true
    }
  }, [picker])

  if (!picker) {
    return null
  }

  const mounts = picker.mounts
  const selectedMountId = picker.selectedMountId
  const canConfirm = mounts.some(mount => mount.mountId === selectedMountId)

  return (
    <AnchoredOperationPopover
      anchor={picker.anchor}
      ariaLabel={t('spaceTargetMountPicker.title')}
      className="workspace-space-target-mount-popover"
      estimatedHeight={Math.min(440, 150 + mounts.length * 62)}
      onDismiss={onCancel}
      testId="workspace-space-target-mount-window"
    >
      <section className="workspace-space-target-mount">
        <h3>{t('spaceTargetMountPicker.title')}</h3>
        <p>{t('spaceTargetMountPicker.description')}</p>

        <div className="cove-window__fields">
          <div className="cove-window__field-row">
            <label>{t('spaceTargetMountPicker.mountLabel')}</label>
            <div className="workspace-space-target-mount__list">
              {mounts.map(mount => {
                const endpointLabel = endpointLabelById[mount.endpointId] ?? mount.endpointId
                return (
                  <label key={mount.mountId} className="workspace-space-target-mount__option">
                    <input
                      type="radio"
                      name="space-target-mount"
                      checked={selectedMountId === mount.mountId}
                      data-testid={`workspace-space-target-mount-${mount.mountId}`}
                      onChange={() => {
                        setPicker(prev =>
                          prev ? { ...prev, selectedMountId: mount.mountId } : prev,
                        )
                      }}
                    />
                    <div className="workspace-space-target-mount__option-copy">
                      <strong>{mount.name}</strong>
                      <span>
                        {endpointLabel} · {mount.rootPath}
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <div className="cove-window__actions workspace-task-creator__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost workspace-task-creator__action workspace-task-creator__action--ghost"
            data-testid="workspace-space-target-mount-cancel"
            onClick={() => {
              onCancel()
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="cove-window__action cove-window__action--primary workspace-task-creator__action workspace-task-creator__action--primary"
            data-testid="workspace-space-target-mount-confirm"
            disabled={!canConfirm}
            onClick={() => {
              onConfirm()
            }}
          >
            {t('common.create')}
          </button>
        </div>
      </section>
    </AnchoredOperationPopover>
  )
}
