import React, { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from '@app/renderer/i18n'
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
    <div
      className="cove-window-backdrop workspace-task-creator-backdrop"
      data-testid="workspace-space-target-mount-backdrop"
      onClick={() => {
        onCancel()
      }}
    >
      <section
        className="cove-window workspace-task-creator"
        data-testid="workspace-space-target-mount-window"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <h3>{t('spaceTargetMountPicker.title')}</h3>
        <p>{t('spaceTargetMountPicker.description')}</p>

        <div className="cove-window__fields">
          <div className="cove-window__field-row">
            <label>{t('spaceTargetMountPicker.mountLabel')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              {mounts.map(mount => {
                const endpointLabel = endpointLabelById[mount.endpointId] ?? mount.endpointId
                return (
                  <label
                    key={mount.mountId}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      border: '1px solid var(--cove-border-subtle)',
                      background: 'var(--cove-field)',
                      borderRadius: 12,
                      padding: '10px 12px',
                      cursor: 'pointer',
                    }}
                  >
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
                      style={{ marginTop: 2 }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--cove-text)' }}>
                        {mount.name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--cove-text-muted)' }}>
                        {endpointLabel} · {mount.rootPath}
                      </div>
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
    </div>
  )
}
