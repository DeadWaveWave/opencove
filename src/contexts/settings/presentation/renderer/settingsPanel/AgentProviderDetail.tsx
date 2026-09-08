import React from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL } from '@contexts/settings/domain/agentSettings'
import type { AgentProviderAvailability } from '@shared/contracts/dto'
import { AgentProviderConfigurePanel } from './AgentProviderConfigurePanel'
import { resolveInstallActionLabel } from './agentSettingsPresentation'

export function AgentProviderDetail({
  availability,
  isInstalling,
  isBusy,
  installError,
  onInstall,
  onRefresh,
  onBack,
  isDefaultProvider,
  onMakeDefault,
  ...configuration
}: React.ComponentProps<typeof AgentProviderConfigurePanel> & {
  availability?: AgentProviderAvailability
  isInstalling: boolean
  isBusy: boolean
  installError?: string
  onInstall: () => void
  onRefresh: () => void
  onBack: () => void
  isDefaultProvider: boolean
  onMakeDefault: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { provider, settings } = configuration
  const label = AGENT_PROVIDER_LABEL[provider]
  const installLabel = resolveInstallActionLabel(availability, t, isInstalling)
  const override = settings.agentExecutablePathOverrideByProvider[provider]?.trim()
  const diagnostics =
    availability?.status === 'misconfigured' ? availability.diagnostics.join(' ') : ''
  return (
    <div className="settings-agent-detail" data-testid={`settings-agent-detail-${provider}`}>
      <button
        type="button"
        className="settings-agent-detail__back"
        data-testid={`settings-agent-configure-done-${provider}`}
        onClick={onBack}
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {t('settingsPanel.agentDetail.back')}
      </button>
      <header className="settings-agent-detail__header">
        <AgentProviderIcon provider={provider} className="settings-agent-detail__icon" />
        <div>
          <h3 tabIndex={-1} data-settings-agent-detail-heading>
            {label}
          </h3>
          <p className="settings-agent-detail__help">
            {t('settingsPanel.agentDetail.description', { provider: label })}
          </p>
        </div>
      </header>
      <div className="settings-panel__row settings-agent-detail__default">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.agent.defaultAgentLabel')}</strong>
        </div>
        <div className="settings-panel__control">
          {isDefaultProvider ? (
            <span className="settings-agent-list-row__default">
              {t('settingsPanel.agent.defaultBadge')}
            </span>
          ) : (
            <button
              type="button"
              className="secondary"
              data-testid={`settings-agent-make-default-${provider}`}
              onClick={onMakeDefault}
            >
              {t('settingsPanel.agentDetail.makeDefault')}
            </button>
          )}
        </div>
      </div>
      <section
        className="settings-agent-detail__runtime"
        aria-labelledby={`settings-agent-runtime-title-${provider}`}
      >
        <div className="settings-agent-detail__runtime-heading">
          <h4 id={`settings-agent-runtime-title-${provider}`}>
            {t('settingsPanel.agentDetail.runtime')}
          </h4>
          <div className="settings-agent-detail__runtime-actions">
            <button
              type="button"
              className="secondary settings-agent-refresh"
              disabled={isBusy}
              onClick={onRefresh}
              data-testid={`settings-agent-refresh-${provider}`}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {t('settingsPanel.agentDetail.refresh')}
            </button>
            <button
              type="button"
              className="secondary settings-agent-install__button"
              data-testid={`settings-agent-executable-install-${provider}`}
              data-status={isInstalling ? 'installing' : (availability?.status ?? 'loading')}
              aria-label={`${label} ${installLabel}`}
              disabled={isBusy || availability?.status !== 'unavailable'}
              onClick={onInstall}
            >
              {installLabel}
            </button>
          </div>
        </div>
        {installError ? (
          <p
            className="settings-agent-install-item__error"
            role="alert"
            data-testid={`settings-agent-executable-install-error-${provider}`}
          >
            {installError}
          </p>
        ) : null}
        {diagnostics ? (
          <p
            className="settings-agent-install-item__error"
            role="status"
            data-testid={`settings-agent-executable-diagnostics-${provider}`}
          >
            {diagnostics}
          </p>
        ) : null}
        <details>
          <summary>{t('settingsPanel.agentDetail.executablePath')}</summary>
          <div
            id={`settings-agent-runtime-${provider}`}
            className="settings-agent-detail__disclosure-content"
          >
            <div className="settings-agent-detail__path">
              <code>{availability?.executablePath ?? '—'}</code>
            </div>
            {override ? (
              <div className="settings-agent-detail__path">
                <span>{t('settingsPanel.agentDetail.executableOverride')}</span>
                <code>{override}</code>
              </div>
            ) : null}
          </div>
        </details>
      </section>
      <AgentProviderConfigurePanel {...configuration} />
    </div>
  )
}
