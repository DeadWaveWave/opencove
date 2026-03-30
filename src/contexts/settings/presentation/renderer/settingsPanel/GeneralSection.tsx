import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
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
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useSystemFonts } from '@app/renderer/shell/hooks/useSystemFonts'
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

function FontFamilyRow({
  terminalFontFamily,
  onChangeTerminalFontFamily,
}: {
  terminalFontFamily: string | null
  onChangeTerminalFontFamily: (family: string | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { fonts, isLoading } = useSystemFonts()
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const visibleFonts = fonts.filter(f => {
    if (!showAll && !f.monospace) {
      return false
    }
    if (query.trim().length > 0) {
      return f.name.toLowerCase().includes(query.trim().toLowerCase())
    }
    return true
  })

  const displayValue = terminalFontFamily ?? t('settingsPanel.general.terminalFontFamilyDefault')

  const open = useCallback(() => {
    setIsOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
  }, [])

  const select = useCallback(
    (name: string | null) => {
      onChangeTerminalFontFamily(name)
      close()
    },
    [onChangeTerminalFontFamily, close],
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, close])

  return (
    <div className="settings-panel__row">
      <div className="settings-panel__row-label">
        <strong>{t('settingsPanel.general.terminalFontFamily')}</strong>
      </div>
      <div
        className="settings-panel__control"
        style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}
      >
        <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
          <button
            type="button"
            className="cove-field cove-select__trigger"
            style={{ width: '100%' }}
            onClick={() => (isOpen ? close() : open())}
            data-testid="settings-terminal-font-family"
          >
            <span className="cove-select__label">
              {isLoading ? t('settingsPanel.general.terminalFontFamilyLoading') : displayValue}
            </span>
            <ChevronDown
              aria-hidden="true"
              size={16}
              className={`cove-select__chevron${isOpen ? ' cove-select__chevron--open' : ''}`}
            />
          </button>

          {isOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 140,
                background: 'color-mix(in srgb, var(--cove-surface-strong) 88%, transparent)',
                backdropFilter: 'blur(18px) saturate(130%)',
                border: '1px solid var(--cove-border)',
                borderRadius: 12,
                boxShadow: '0 22px 48px var(--cove-shadow-color-elevated)',
                marginTop: 4,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                padding: 6,
              }}
            >
              <div style={{ padding: '8px 8px 4px' }}>
                <input
                  ref={inputRef}
                  type="text"
                  className="cove-field"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder={t('settingsPanel.general.terminalFontFamilySearch')}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
              <div
                style={{ padding: '2px 8px 6px', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <input
                  type="checkbox"
                  id="font-show-all"
                  checked={showAll}
                  onChange={e => setShowAll(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label
                  htmlFor="font-show-all"
                  style={{ fontSize: 12, color: 'var(--cove-text-muted)', cursor: 'pointer' }}
                >
                  {t('settingsPanel.general.terminalFontFamilyShowAll')}
                </label>
              </div>
              <ul
                ref={listRef}
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: '4px 0',
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                <li>
                  <button
                    type="button"
                    className={`cove-select__option${terminalFontFamily === null ? ' cove-select__option--selected' : ''}`}
                    onClick={() => select(null)}
                  >
                    {t('settingsPanel.general.terminalFontFamilyDefault')}
                  </button>
                </li>
                {visibleFonts.map(font => (
                  <li key={font.name}>
                    <button
                      type="button"
                      className={`cove-select__option${terminalFontFamily === font.name ? ' cove-select__option--selected' : ''}`}
                      style={{ fontFamily: font.name }}
                      onClick={() => select(font.name)}
                    >
                      {font.name}
                    </button>
                  </li>
                ))}
                {!isLoading && visibleFonts.length === 0 && (
                  <li
                    style={{ padding: '6px 12px', color: 'var(--cove-text-muted)', fontSize: 13 }}
                  >
                    {t('settingsPanel.general.terminalFontFamilyNoResults')}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function GeneralSection(props: {
  language: UiLanguage
  uiTheme: UiTheme
  uiFontSize: number
  terminalFontSize: number
  terminalFontFamily: string | null
  updatePolicy: AppUpdatePolicy
  updateChannel: AppUpdateChannel
  updateState: AppUpdateState | null
  onChangeLanguage: (language: UiLanguage) => void
  onChangeUiTheme: (theme: UiTheme) => void
  onChangeUiFontSize: (size: number) => void
  onChangeTerminalFontSize: (size: number) => void
  onChangeTerminalFontFamily: (family: string | null) => void
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
    terminalFontFamily,
    updatePolicy,
    updateChannel,
    updateState,
    onChangeLanguage,
    onChangeUiTheme,
    onChangeUiFontSize,
    onChangeTerminalFontSize,
    onChangeTerminalFontFamily,
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

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.uiThemeLabel')}</strong>
          <span>{t('settingsPanel.general.uiThemeHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <CoveSelect
            id="settings-ui-theme"
            testId="settings-ui-theme"
            value={uiTheme}
            options={UI_THEMES.map(theme => ({
              value: theme,
              label: getUiThemeLabel(t, theme),
            }))}
            onChange={nextValue => onChangeUiTheme(nextValue as UiTheme)}
          />
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
            className="cove-field"
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
            className="cove-field"
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

      <FontFamilyRow
        terminalFontFamily={terminalFontFamily}
        onChangeTerminalFontFamily={onChangeTerminalFontFamily}
      />

      <div className="settings-panel__subsection">
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
