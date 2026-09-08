import React from 'react'
import { ChevronDown, ChevronRight, ChevronUp, RefreshCw } from 'lucide-react'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
  type AgentProvider,
  type AgentSettings,
} from '@contexts/settings/domain/agentSettings'
import type { AgentProviderAvailability } from '@shared/contracts/dto'
import {
  resolveEnvSummary,
  resolveInstallActionLabel,
  resolveModelSummary,
} from './agentSettingsPresentation'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export function AgentSection(props: {
  defaultProvider: AgentProvider
  agentProviderOrder: AgentProvider[]
  agentFullAccess: boolean
  availabilityByProvider: Record<string, AgentProviderAvailability>
  installingProvider: AgentProvider | null
  installErrorByProvider: Record<string, string>
  isRefreshingAvailability: boolean
  settings: AgentSettings
  onChangeDefaultProvider: (provider: AgentProvider) => void
  onChangeAgentProviderOrder: (providers: AgentProvider[]) => void
  onChangeAgentFullAccess: (enabled: boolean) => void
  onInstallProvider: (provider: AgentProvider) => void
  onConfigureProvider: (provider: AgentProvider) => void
  onRefreshAvailability: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    defaultProvider,
    agentProviderOrder,
    agentFullAccess,
    availabilityByProvider,
    installingProvider,
    installErrorByProvider,
    isRefreshingAvailability,
    settings,
    onChangeDefaultProvider,
    onChangeAgentProviderOrder,
    onChangeAgentFullAccess,
    onInstallProvider,
    onConfigureProvider,
    onRefreshAvailability,
  } = props

  const moveProvider = (fromIndex: number, toIndex: number): void => {
    if (fromIndex === toIndex) {
      return
    }

    if (fromIndex < 0 || fromIndex >= agentProviderOrder.length) {
      return
    }

    if (toIndex < 0 || toIndex >= agentProviderOrder.length) {
      return
    }

    const next = [...agentProviderOrder]
    const [moved] = next.splice(fromIndex, 1)
    if (!moved) {
      return
    }

    next.splice(toIndex, 0, moved)
    onChangeAgentProviderOrder(next)
  }

  return (
    <>
      <SettingsGroup
        id="settings-section-agent"
        title={t('settingsPanel.groups.agent.providers')}
        description={t('settingsPanel.agent.agentProviderOrderHelp')}
      >
        <div className="settings-agent-list-block" id="settings-agent-list">
          <div className="settings-agent-list-toolbar">
            <button
              type="button"
              className="secondary settings-agent-refresh"
              data-testid="settings-agent-refresh"
              disabled={isRefreshingAvailability || Boolean(installingProvider)}
              onClick={onRefreshAvailability}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {t('settingsPanel.agentDetail.refresh')}
            </button>
          </div>
          <div className="settings-list-container">
            {agentProviderOrder.map((provider, index) => {
              const availability = availabilityByProvider[provider]
              const isInstallingProvider = installingProvider === provider
              const diagnostics = availability?.diagnostics?.join(' ') ?? ''
              const installError = installErrorByProvider[provider] ?? ''
              const isUnavailable = availability?.status === 'unavailable'
              const isMisconfigured = availability?.status === 'misconfigured'
              const isBusy = isRefreshingAvailability || Boolean(installingProvider)
              const installLabel = resolveInstallActionLabel(availability, t, isInstallingProvider)
              const actionStatus = isInstallingProvider
                ? 'installing'
                : (availability?.status ?? 'loading')
              const modelSummary = resolveModelSummary(settings, provider, t)
              const envSummary = resolveEnvSummary(settings, provider, t)

              return (
                <div className="settings-agent-list-item" key={provider}>
                  <div
                    className="settings-list-item settings-agent-list-row"
                    data-testid={`settings-agent-order-item-${provider}`}
                  >
                    <div className="settings-agent-order__actions">
                      <button
                        type="button"
                        className="secondary settings-agent-order__action"
                        data-testid={`settings-agent-order-move-up-${provider}`}
                        disabled={index === 0}
                        aria-label={t('settingsPanel.agent.moveUp')}
                        onClick={() => moveProvider(index, index - 1)}
                      >
                        <ChevronUp className="settings-agent-order__icon" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="secondary settings-agent-order__action"
                        data-testid={`settings-agent-order-move-down-${provider}`}
                        disabled={index === agentProviderOrder.length - 1}
                        aria-label={t('settingsPanel.agent.moveDown')}
                        onClick={() => moveProvider(index, index + 1)}
                      >
                        <ChevronDown className="settings-agent-order__icon" aria-hidden="true" />
                      </button>
                    </div>
                    <label className="settings-agent-default-choice">
                      <input
                        type="radio"
                        name="settings-default-provider"
                        value={provider}
                        data-testid={`settings-default-provider-${provider}`}
                        checked={defaultProvider === provider}
                        aria-label={`${AGENT_PROVIDER_LABEL[provider]} ${t('settingsPanel.agent.defaultAgentLabel')}`}
                        onChange={() => onChangeDefaultProvider(provider)}
                      />
                      <span className="settings-agent-default-choice__visual" aria-hidden="true" />
                    </label>
                    <button
                      type="button"
                      className="settings-agent-identity"
                      data-testid={`settings-agent-configure-${provider}`}
                      aria-label={`${AGENT_PROVIDER_LABEL[provider]} ${t('settingsPanel.agent.configure')}`}
                      onClick={() => onConfigureProvider(provider)}
                    >
                      <AgentProviderIcon
                        provider={provider}
                        className="settings-agent-list-row__icon"
                      />
                      <span className="settings-agent-identity__text">
                        <span className="settings-agent-identity__name">
                          <strong className="settings-agent-list-row__name">
                            {AGENT_PROVIDER_LABEL[provider]}
                          </strong>
                          {defaultProvider === provider ? (
                            <span className="settings-agent-list-row__default">
                              {t('settingsPanel.agent.defaultBadge')}
                            </span>
                          ) : null}
                        </span>
                        <span className="settings-agent-list-row__summary">
                          <span>{modelSummary}</span>
                          <span>{envSummary}</span>
                        </span>
                      </span>
                      <ChevronRight
                        size={15}
                        className="settings-agent-identity__chevron"
                        aria-hidden="true"
                      />
                    </button>
                    <div className="settings-agent-list-row__actions">
                      <button
                        type="button"
                        className="secondary settings-agent-install__button"
                        data-status={actionStatus}
                        data-testid={`settings-agent-executable-install-${provider}`}
                        aria-label={`${AGENT_PROVIDER_LABEL[provider]} ${installLabel}`}
                        onClick={() => onInstallProvider(provider)}
                        disabled={!isUnavailable || isBusy}
                      >
                        {installLabel}
                      </button>
                    </div>
                  </div>

                  {installError.length > 0 ? (
                    <div
                      className="settings-agent-install-item__error"
                      data-testid={`settings-agent-executable-install-error-${provider}`}
                    >
                      {installError}
                    </div>
                  ) : null}
                  {isMisconfigured && diagnostics.length > 0 ? (
                    <div
                      className="settings-agent-install-item__error"
                      data-testid={`settings-agent-executable-diagnostics-${provider}`}
                    >
                      {diagnostics}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        id="settings-section-agent-permissions"
        title={t('settingsPanel.groups.agent.permissions')}
      >
        <SettingsGroupBody>
          <div className="settings-panel__row" id="settings-agent-full-access">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.agent.fullAccessLabel')}</strong>
              <span>{t('settingsPanel.agent.fullAccessHelp')}</span>
            </div>
            <div className="settings-panel__control">
              <label className="cove-toggle">
                <input
                  type="checkbox"
                  data-testid="settings-agent-full-access"
                  checked={agentFullAccess}
                  aria-label={t('settingsPanel.agent.fullAccessLabel')}
                  onChange={event => onChangeAgentFullAccess(event.target.checked)}
                />
                <span className="cove-toggle__slider"></span>
              </label>
            </div>
          </div>
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
