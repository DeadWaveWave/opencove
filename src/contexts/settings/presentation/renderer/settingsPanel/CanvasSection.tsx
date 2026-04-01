import React, { useCallback, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  CANVAS_INPUT_MODES,
  FOCUS_NODE_TARGET_ZOOM_STEP,
  MAX_FOCUS_NODE_TARGET_ZOOM,
  MIN_FOCUS_NODE_TARGET_ZOOM,
  type CanvasInputMode,
  type FocusNodeTargetZoom,
  STANDARD_WINDOW_SIZE_BUCKETS,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import {
  getCanvasInputModeLabel,
  getStandardWindowSizeBucketLabel,
} from '@app/renderer/i18n/labels'
import type { TerminalProfile, WebsiteWindowPolicy } from '@shared/contracts/dto'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

export function CanvasSection(props: {
  canvasInputMode: CanvasInputMode
  standardWindowSizeBucket: StandardWindowSizeBucket
  focusNodeOnClick: boolean
  focusNodeTargetZoom: FocusNodeTargetZoom
  websiteWindowPolicy: WebsiteWindowPolicy
  defaultTerminalProfileId: string | null
  terminalProfiles: TerminalProfile[]
  detectedDefaultTerminalProfileId: string | null
  onChangeCanvasInputMode: (mode: CanvasInputMode) => void
  onChangeStandardWindowSizeBucket: (bucket: StandardWindowSizeBucket) => void
  onChangeDefaultTerminalProfileId: (profileId: string | null) => void
  onChangeFocusNodeOnClick: (enabled: boolean) => void
  onChangeFocusNodeTargetZoom: (zoom: FocusNodeTargetZoom) => void
  onChangeWebsiteWindowPolicy: (policy: WebsiteWindowPolicy) => void
  onFocusNodeTargetZoomPreviewChange: (isPreviewing: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    canvasInputMode,
    standardWindowSizeBucket,
    focusNodeOnClick,
    focusNodeTargetZoom,
    websiteWindowPolicy,
    defaultTerminalProfileId,
    terminalProfiles,
    detectedDefaultTerminalProfileId,
    onChangeCanvasInputMode,
    onChangeStandardWindowSizeBucket,
    onChangeDefaultTerminalProfileId,
    onChangeFocusNodeOnClick,
    onChangeFocusNodeTargetZoom,
    onChangeWebsiteWindowPolicy,
    onFocusNodeTargetZoomPreviewChange,
  } = props
  const neutralTargetZoom = 1
  const neutralTargetZoomRatioRaw =
    (neutralTargetZoom - MIN_FOCUS_NODE_TARGET_ZOOM) /
    (MAX_FOCUS_NODE_TARGET_ZOOM - MIN_FOCUS_NODE_TARGET_ZOOM)
  const neutralTargetZoomRatio = Number.isFinite(neutralTargetZoomRatioRaw)
    ? Math.max(0, Math.min(1, neutralTargetZoomRatioRaw))
    : 0.5
  const focusTargetZoomRangeStyle: React.CSSProperties & Record<string, string | number> = {
    '--settings-panel-range-neutral-ratio': neutralTargetZoomRatio,
  }
  const selectedProfileId = terminalProfiles.some(
    profile => profile.id === defaultTerminalProfileId,
  )
    ? defaultTerminalProfileId
    : null
  const [keepAliveHostDraft, setKeepAliveHostDraft] = useState('')

  const updateWebsiteWindowPolicy = useCallback(
    (patch: Partial<WebsiteWindowPolicy>) => {
      onChangeWebsiteWindowPolicy({
        ...websiteWindowPolicy,
        ...patch,
      })
    },
    [onChangeWebsiteWindowPolicy, websiteWindowPolicy],
  )

  const removeKeepAliveHost = useCallback(
    (pattern: string) => {
      updateWebsiteWindowPolicy({
        keepAliveHosts: websiteWindowPolicy.keepAliveHosts.filter(item => item !== pattern),
      })
    },
    [updateWebsiteWindowPolicy, websiteWindowPolicy.keepAliveHosts],
  )

  const addKeepAliveHost = useCallback(() => {
    const normalized = keepAliveHostDraft.trim()
    if (normalized.length === 0) {
      return
    }

    if (websiteWindowPolicy.keepAliveHosts.includes(normalized)) {
      setKeepAliveHostDraft('')
      return
    }

    updateWebsiteWindowPolicy({
      keepAliveHosts: [...websiteWindowPolicy.keepAliveHosts, normalized].slice(0, 64),
    })
    setKeepAliveHostDraft('')
  }, [keepAliveHostDraft, updateWebsiteWindowPolicy, websiteWindowPolicy.keepAliveHosts])

  return (
    <div className="settings-panel__section" id="settings-section-canvas">
      <h3 className="settings-panel__section-title">{t('settingsPanel.canvas.title')}</h3>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.inputModeLabel')}</strong>
          <span>{t('settingsPanel.canvas.inputModeHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <CoveSelect
            id="settings-canvas-input-mode"
            testId="settings-canvas-input-mode"
            value={canvasInputMode}
            options={CANVAS_INPUT_MODES.map(mode => ({
              value: mode,
              label: getCanvasInputModeLabel(t, mode),
            }))}
            onChange={nextValue => onChangeCanvasInputMode(nextValue as CanvasInputMode)}
          />
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.standardWindowSizeLabel')}</strong>
          <span>{t('settingsPanel.canvas.standardWindowSizeHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <CoveSelect
            id="settings-standard-window-size"
            testId="settings-standard-window-size"
            value={standardWindowSizeBucket}
            options={STANDARD_WINDOW_SIZE_BUCKETS.map(bucket => ({
              value: bucket,
              label: getStandardWindowSizeBucketLabel(t, bucket),
            }))}
            onChange={nextValue =>
              onChangeStandardWindowSizeBucket(nextValue as StandardWindowSizeBucket)
            }
          />
        </div>
      </div>

      {terminalProfiles.length > 0 ? (
        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.canvas.terminalProfileLabel')}</strong>
            <span>
              {t('settingsPanel.canvas.terminalProfileHelp', {
                defaultProfile:
                  terminalProfiles.find(profile => profile.id === detectedDefaultTerminalProfileId)
                    ?.label ?? t('settingsPanel.canvas.terminalProfileAuto'),
              })}
            </span>
          </div>
          <div className="settings-panel__control">
            <CoveSelect
              id="settings-terminal-profile"
              testId="settings-terminal-profile"
              value={selectedProfileId ?? ''}
              options={[
                {
                  value: '',
                  label: t('settingsPanel.canvas.terminalProfileAutoWithDefault', {
                    defaultProfile:
                      terminalProfiles.find(
                        profile => profile.id === detectedDefaultTerminalProfileId,
                      )?.label ?? t('settingsPanel.canvas.terminalProfileAuto'),
                  }),
                },
                ...terminalProfiles.map(profile => ({
                  value: profile.id,
                  label: profile.label,
                })),
              ]}
              onChange={nextValue =>
                onChangeDefaultTerminalProfileId(nextValue.trim().length > 0 ? nextValue : null)
              }
            />
          </div>
        </div>
      ) : null}

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.focusOnClickLabel')}</strong>
          <span>{t('settingsPanel.canvas.focusOnClickHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <label className="cove-toggle">
            <input
              type="checkbox"
              data-testid="settings-focus-node-on-click"
              checked={focusNodeOnClick}
              onChange={event => onChangeFocusNodeOnClick(event.target.checked)}
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
      </div>

      <div className="settings-panel__row settings-panel__row--focus-target-zoom">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.focusTargetZoomLabel')}</strong>
          <span>{t('settingsPanel.canvas.focusTargetZoomHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <div
            className="settings-panel__range settings-panel__range--neutral-marker"
            style={focusTargetZoomRangeStyle}
          >
            <input
              id="settings-focus-node-target-zoom"
              data-testid="settings-focus-node-target-zoom"
              value={focusNodeTargetZoom}
              disabled={!focusNodeOnClick}
              type="range"
              min={MIN_FOCUS_NODE_TARGET_ZOOM}
              max={MAX_FOCUS_NODE_TARGET_ZOOM}
              step={FOCUS_NODE_TARGET_ZOOM_STEP}
              onPointerDown={() => onFocusNodeTargetZoomPreviewChange(true)}
              onPointerUp={() => onFocusNodeTargetZoomPreviewChange(false)}
              onPointerCancel={() => onFocusNodeTargetZoomPreviewChange(false)}
              onBlur={() => onFocusNodeTargetZoomPreviewChange(false)}
              onChange={event => onChangeFocusNodeTargetZoom(Number(event.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <strong>{t('settingsPanel.canvas.websiteWindowsTitle')}</strong>
          <span>{t('settingsPanel.canvas.websiteWindowsHelp')}</span>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.canvas.websiteWindowMaxActiveLabel')}</strong>
            <span>{t('settingsPanel.canvas.websiteWindowMaxActiveHelp')}</span>
          </div>
          <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
            <input
              id="settings-website-window-max-active"
              data-testid="settings-website-window-max-active"
              className="cove-field"
              style={{ width: '80px' }}
              type="number"
              min={1}
              max={6}
              value={websiteWindowPolicy.maxActiveCount}
              onChange={event => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) {
                  return
                }
                updateWebsiteWindowPolicy({ maxActiveCount: next })
              }}
            />
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.canvas.websiteWindowDiscardAfterLabel')}</strong>
            <span>{t('settingsPanel.canvas.websiteWindowDiscardAfterHelp')}</span>
          </div>
          <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
            <input
              id="settings-website-window-discard-after"
              data-testid="settings-website-window-discard-after"
              className="cove-field"
              style={{ width: '80px' }}
              type="number"
              min={1}
              max={240}
              value={websiteWindowPolicy.discardAfterMinutes}
              onChange={event => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) {
                  return
                }
                updateWebsiteWindowPolicy({ discardAfterMinutes: next })
              }}
            />
            <span style={{ fontSize: '12px', color: 'var(--cove-text-muted)' }}>
              {t('common.minuteUnit')}
            </span>
          </div>
        </div>

        <div className="settings-panel__subsection">
          <div className="settings-panel__subsection-header">
            <strong>{t('settingsPanel.canvas.websiteWindowKeepAliveHostsLabel')}</strong>
            <span>{t('settingsPanel.canvas.websiteWindowKeepAliveHostsHelp')}</span>
          </div>

          <div
            className="settings-list-container"
            data-testid="settings-website-window-keep-alive-hosts"
          >
            {websiteWindowPolicy.keepAliveHosts.map(pattern => (
              <div className="settings-list-item" key={pattern}>
                <span className="settings-panel__value">{pattern}</span>
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: '2px 8px', fontSize: '11px' }}
                  data-testid={`settings-website-keep-alive-remove-${pattern}`}
                  onClick={() => removeKeepAliveHost(pattern)}
                >
                  {t('common.remove')}
                </button>
              </div>
            ))}
          </div>

          <div className="settings-panel__input-row">
            <input
              type="text"
              data-testid="settings-website-keep-alive-add-input"
              className="cove-field"
              value={keepAliveHostDraft}
              placeholder={t('settingsPanel.canvas.websiteWindowKeepAliveHostsPlaceholder')}
              onChange={event => setKeepAliveHostDraft(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && addKeepAliveHost()}
            />
            <button
              type="button"
              className="primary"
              data-testid="settings-website-keep-alive-add-button"
              disabled={keepAliveHostDraft.trim().length === 0}
              onClick={() => addKeepAliveHost()}
            >
              {t('common.add')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
