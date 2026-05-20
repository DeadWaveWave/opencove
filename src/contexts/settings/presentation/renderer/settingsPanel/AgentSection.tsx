import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { AgentProviderAvailability } from '@shared/contracts/dto'

export function AgentSection(props: {
  defaultProvider: AgentProvider
  agentProviderOrder: AgentProvider[]
  agentFullAccess: boolean
  availabilityByProvider: Record<string, AgentProviderAvailability>
  installingProvider: AgentProvider | null
  installErrorByProvider: Record<string, string>
  isRefreshingAvailability: boolean
  onChangeDefaultProvider: (provider: AgentProvider) => void
  onChangeAgentProviderOrder: (providers: AgentProvider[]) => void
  onChangeAgentFullAccess: (enabled: boolean) => void
  onInstallProvider: (provider: AgentProvider) => void
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
    onChangeDefaultProvider,
    onChangeAgentProviderOrder,
    onChangeAgentFullAccess,
    onInstallProvider,
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
    <div className="settings-panel__section" id="settings-section-agent">
      <h3 className="settings-panel__section-title">{t('settingsPanel.agent.title')}</h3>

      <div className="settings-agent-list-block" id="settings-agent-list">
        <div className="settings-agent-list-block__header">
          <strong>{t('settingsPanel.agent.agentListLabel')}</strong>
          <span>{t('settingsPanel.agent.agentProviderOrderHelp')}</span>
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
                      onChange={() => onChangeDefaultProvider(provider)}
                    />
                    <span className="settings-agent-default-choice__visual" aria-hidden="true" />
                    <span className="settings-agent-default-choice__label">
                      <AgentProviderIcon
                        provider={provider}
                        className="settings-agent-list-row__icon"
                      />
                      <strong className="settings-agent-list-row__name">
                        {AGENT_PROVIDER_LABEL[provider]}
                      </strong>
                      {defaultProvider === provider ? (
                        <span className="settings-agent-list-row__default">
                          {t('settingsPanel.agent.defaultBadge')}
                        </span>
                      ) : null}
                    </span>
                  </label>
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
              onChange={event => onChangeAgentFullAccess(event.target.checked)}
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
      </div>
    </div>
  )
}

function resolveInstallActionLabel(
  availability: AgentProviderAvailability | null | undefined,
  t: ReturnType<typeof useTranslation>['t'],
  isInstalling = false,
): string {
  if (isInstalling) {
    return t('settingsPanel.agentExecutable.status.installing')
  }

  if (!availability) {
    return t('common.loading')
  }

  if (availability.status === 'available') {
    return t('settingsPanel.agentExecutable.status.available')
  }

  if (availability.status === 'misconfigured') {
    return t('settingsPanel.agentExecutable.status.misconfigured')
  }

  return t('settingsPanel.agentExecutable.install')
}
