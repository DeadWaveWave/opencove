import React from 'react'
import {
  UI_LANGUAGES,
  UI_THEMES,
  MAX_TERMINAL_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  type UiLanguage,
  type UiTheme,
} from '@contexts/settings/domain/agentSettings'
import { useTranslation } from '@app/renderer/i18n'
import {
  getAppUpdateChannelLabel,
  getAppUpdatePolicyLabel,
  getUiLanguageLabel,
  getUiThemeLabel,
} from '@app/renderer/i18n/labels'
import type { AppUpdateChannel, AppUpdatePolicy, AppUpdateState } from '@shared/contracts/dto'
import { APP_UPDATE_CHANNELS, APP_UPDATE_POLICIES } from '@shared/contracts/dto'

function getUpdateStatusText(
  t: ReturnType<typeof useTranslation>['t'],
  state: AppUpdateState | null,
): string {
  if (!state) {
    return t('common.loading')
  }

  switch (state.status) {
    case 'disabled':
      return t('settingsPanel.general.updates.status.disabled')
    case 'unsupported':
      return t('settingsPanel.general.updates.status.unsupported')
    case 'checking':
      return t('settingsPanel.general.updates.status.checking')
    case 'available':
      return t('settingsPanel.general.updates.status.available', {
        version: state.latestVersion ?? state.currentVersion,
      })
    case 'downloading':
      return t('settingsPanel.general.updates.status.downloading', {
        version: state.latestVersion ?? state.currentVersion,
        percent: `${Math.round(state.downloadPercent ?? 0)}%`,
      })
    case 'downloaded':
      return t('settingsPanel.general.updates.status.downloaded', {
        version: state.latestVersion ?? state.currentVersion,
      })
    case 'up_to_date':
      return t('settingsPanel.general.updates.status.upToDate')
    case 'error':
      return t('settingsPanel.general.updates.status.error', {
        message: state.message ?? t('common.unknownError'),
      })
    default:
      return t('settingsPanel.general.updates.status.idle')
  }
}

export function GeneralSection(props: {
  language: UiLanguage
  uiTheme: UiTheme
  uiFontSize: number
  terminalFontSize: number
  updatePolicy: AppUpdatePolicy
  updateChannel: AppUpdateChannel
  updateState: AppUpdateState | null
  onChangeLanguage: (language: UiLanguage) => void
  onChangeUiTheme: (theme: UiTheme) => void
  onChangeUiFontSize: (size: number) => void
  onChangeTerminalFontSize: (size: number) => void
  onChangeUpdatePolicy: (policy: AppUpdatePolicy) => void
  onChangeUpdateChannel: (channel: AppUpdateChannel) => void
  onCheckForUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    language,
    uiTheme,
    uiFontSize,
    terminalFontSize,
    updatePolicy,
    updateChannel,
    updateState,
    onChangeLanguage,
    onChangeUiTheme,
    onChangeUiFontSize,
    onChangeTerminalFontSize,
    onChangeUpdatePolicy,
    onChangeUpdateChannel,
    onCheckForUpdates,
    onDownloadUpdate,
    onInstallUpdate,
  } = props

  return (
    <div className="settings-panel__section" id="settings-section-general">
      <h3 className="settings-panel__section-title">{t('settingsPanel.general.title')}</h3>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.languageLabel')}</strong>
          <span>{t('settingsPanel.general.languageHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <select
            id="settings-language"
            data-testid="settings-language"
            value={language}
            onChange={event => {
              onChangeLanguage(event.target.value as UiLanguage)
            }}
          >
            {UI_LANGUAGES.map(option => (
              <option value={option} key={option}>
                {getUiLanguageLabel(option)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.uiThemeLabel')}</strong>
          <span>{t('settingsPanel.general.uiThemeHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <select
            id="settings-ui-theme"
            data-testid="settings-ui-theme"
            value={uiTheme}
            onChange={event => onChangeUiTheme(event.target.value as UiTheme)}
          >
            {UI_THEMES.map(theme => (
              <option key={theme} value={theme}>
                {getUiThemeLabel(t, theme)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.interfaceFontSize')}</strong>
        </div>
        <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
          <input
            id="settings-ui-font-size"
            data-testid="settings-ui-font-size"
            style={{ width: '80px' }}
            type="number"
            min={MIN_UI_FONT_SIZE}
            max={MAX_UI_FONT_SIZE}
            value={uiFontSize}
            onChange={event => onChangeUiFontSize(Number(event.target.value))}
          />
          <span style={{ fontSize: '12px', color: 'var(--cove-text-muted)' }}>
            {t('common.pixelUnit')}
          </span>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.terminalFontSize')}</strong>
        </div>
        <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
          <input
            id="settings-terminal-font-size"
            data-testid="settings-terminal-font-size"
            style={{ width: '80px' }}
            type="number"
            min={MIN_TERMINAL_FONT_SIZE}
            max={MAX_TERMINAL_FONT_SIZE}
            value={terminalFontSize}
            onChange={event => onChangeTerminalFontSize(Number(event.target.value))}
          />
          <span style={{ fontSize: '12px', color: 'var(--cove-text-muted)' }}>
            {t('common.pixelUnit')}
          </span>
        </div>
      </div>

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <strong>{t('settingsPanel.general.updates.title')}</strong>
          <span>{t('settingsPanel.general.updates.help')}</span>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.general.updates.currentVersionLabel')}</strong>
          </div>
          <div className="settings-panel__control">
            <span className="settings-panel__value">{updateState?.currentVersion ?? '—'}</span>
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.general.updates.policyLabel')}</strong>
            <span>{t('settingsPanel.general.updates.policyHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <select
              id="settings-update-policy"
              data-testid="settings-update-policy"
              value={updatePolicy}
              onChange={event => onChangeUpdatePolicy(event.target.value as AppUpdatePolicy)}
            >
              {(updateChannel === 'nightly'
                ? APP_UPDATE_POLICIES.filter(policy => policy !== 'auto')
                : APP_UPDATE_POLICIES
              ).map(policy => (
                <option key={policy} value={policy}>
                  {getAppUpdatePolicyLabel(t, policy)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.general.updates.channelLabel')}</strong>
            <span>{t('settingsPanel.general.updates.channelHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <select
              id="settings-update-channel"
              data-testid="settings-update-channel"
              value={updateChannel}
              onChange={event => onChangeUpdateChannel(event.target.value as AppUpdateChannel)}
            >
              {APP_UPDATE_CHANNELS.map(channel => (
                <option key={channel} value={channel}>
                  {getAppUpdateChannelLabel(t, channel)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.general.updates.statusLabel')}</strong>
          </div>
          <div className="settings-panel__control">
            <span className="settings-panel__value" data-testid="settings-update-status">
              {getUpdateStatusText(t, updateState)}
            </span>
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.general.updates.actionsLabel')}</strong>
          </div>
          <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="secondary"
              data-testid="settings-update-check"
              onClick={onCheckForUpdates}
              disabled={updateState?.status === 'checking' || updatePolicy === 'off'}
            >
              {t('settingsPanel.general.updates.checkNow')}
            </button>
            {updateState?.status === 'available' ? (
              <button
                type="button"
                className="primary"
                data-testid="settings-update-download"
                onClick={onDownloadUpdate}
              >
                {t('settingsPanel.general.updates.downloadNow')}
              </button>
            ) : null}
            {updateState?.status === 'downloaded' ? (
              <button
                type="button"
                className="primary"
                data-testid="settings-update-install"
                onClick={onInstallUpdate}
              >
                {t('settingsPanel.general.updates.restartToUpdate')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
