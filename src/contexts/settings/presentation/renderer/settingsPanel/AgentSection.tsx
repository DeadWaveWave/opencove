import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

export function AgentSection(props: {
  defaultProvider: AgentProvider
  agentProviderOrder: AgentProvider[]
  agentFullAccess: boolean
  onChangeDefaultProvider: (provider: AgentProvider) => void
  onChangeAgentProviderOrder: (providers: AgentProvider[]) => void
  onChangeAgentFullAccess: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    defaultProvider,
    agentProviderOrder,
    agentFullAccess,
    onChangeDefaultProvider,
    onChangeAgentProviderOrder,
    onChangeAgentFullAccess,
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

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.agent.defaultAgentLabel')}</strong>
          <span>{t('settingsPanel.agent.defaultAgentHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <CoveSelect
            id="settings-default-provider"
            testId="settings-default-provider"
            value={defaultProvider}
            options={agentProviderOrder.map(provider => ({
              value: provider,
              label: AGENT_PROVIDER_LABEL[provider],
            }))}
            onChange={nextValue => {
              onChangeDefaultProvider(nextValue as AgentProvider)
            }}
          />
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.agent.agentProviderOrderLabel')}</strong>
          <span>{t('settingsPanel.agent.agentProviderOrderHelp')}</span>
        </div>
        <div className="settings-panel__control settings-panel__control--stack">
          <div className="settings-list-container">
            {agentProviderOrder.map((provider, index) => (
              <div
                key={provider}
                className="settings-list-item"
                data-testid={`settings-agent-order-item-${provider}`}
              >
                <div className="settings-list-item__left">{AGENT_PROVIDER_LABEL[provider]}</div>
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
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-panel__row">
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
