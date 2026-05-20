import React from 'react'
import { UI_LANGUAGES, type UiLanguage } from '@contexts/settings/domain/agentSettings'
import { useTranslation } from '@app/renderer/i18n'
import {
  getAppUpdateChannelLabel,
  getAppUpdatePolicyLabel,
  getUiLanguageLabel,
} from '@app/renderer/i18n/labels'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
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
      return state.message
        ? t('settingsPanel.general.updates.status.unsupportedWithMessage', {
            message: state.message,
          })
        : t('settingsPanel.general.updates.status.unsupported')
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
  updatePolicy: AppUpdatePolicy
  updateChannel: AppUpdateChannel
  updateState: AppUpdateState | null
  onChangeLanguage: (language: UiLanguage) => void
  onChangeUpdatePolicy: (policy: AppUpdatePolicy) => void
  onChangeUpdateChannel: (channel: AppUpdateChannel) => void
  onCheckForUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    language,
    updatePolicy,
    updateChannel,
    updateState,
    onChangeLanguage,
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
          <CoveSelect
            id="settings-language"
            testId="settings-language"
            value={language}
            options={UI_LANGUAGES.map(option => ({
              value: option,
              label: getUiLanguageLabel(option),
            }))}
            onChange={nextValue => {
              onChangeLanguage(nextValue as UiLanguage)
            }}
          />
        </div>
      </div>

      <div className="settings-panel__subsection" id="settings-section-updates">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">
            {t('settingsPanel.general.updates.title')}
          </h4>
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
            <CoveSelect
              id="settings-update-policy"
              value={updatePolicy}
              testId="settings-update-policy"
              options={(updateChannel === 'nightly'
                ? APP_UPDATE_POLICIES.filter(policy => policy !== 'auto')
                : APP_UPDATE_POLICIES
              ).map(policy => ({
                value: policy,
                label: getAppUpdatePolicyLabel(t, policy),
              }))}
              onChange={nextValue => onChangeUpdatePolicy(nextValue as AppUpdatePolicy)}
            />
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.general.updates.channelLabel')}</strong>
            <span>{t('settingsPanel.general.updates.channelHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <CoveSelect
              id="settings-update-channel"
              value={updateChannel}
              testId="settings-update-channel"
              options={APP_UPDATE_CHANNELS.map(channel => ({
                value: channel,
                label: getAppUpdateChannelLabel(t, channel),
              }))}
              onChange={nextValue => onChangeUpdateChannel(nextValue as AppUpdateChannel)}
            />
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
              disabled={
                updateState?.status === 'checking' ||
                updateState?.status === 'unsupported' ||
                updatePolicy === 'off'
              }
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
