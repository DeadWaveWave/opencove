import React, { useCallback } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
  type AgentProvider,
  type AgentEnvByProvider,
} from '@contexts/settings/domain/agentSettings'

type AgentEnvRowDraft = {
  id: string
  key: string
  value: string
  enabled: boolean
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) {
    return items
  }

  if (fromIndex < 0 || fromIndex >= items.length) {
    return items
  }

  if (toIndex < 0 || toIndex >= items.length) {
    return items
  }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) {
    return items
  }

  next.splice(toIndex, 0, moved)
  return next
}

function createRow(): AgentEnvRowDraft {
  return {
    id: crypto.randomUUID(),
    key: '',
    value: '',
    enabled: true,
  }
}

export function AgentEnvSection({
  agentProviderOrder,
  agentEnvByProvider,
  onChangeAgentEnvByProvider,
}: {
  agentProviderOrder: AgentProvider[]
  agentEnvByProvider: AgentEnvByProvider
  onChangeAgentEnvByProvider: (next: AgentEnvByProvider) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const updateProviderRows = useCallback(
    (provider: AgentProvider, nextRows: AgentEnvRowDraft[]) => {
      onChangeAgentEnvByProvider({
        ...agentEnvByProvider,
        [provider]: nextRows,
      })
    },
    [agentEnvByProvider, onChangeAgentEnvByProvider],
  )

  return (
    <div
      className="settings-panel__section settings-panel__section--vertical"
      id="settings-section-agent-env"
    >
      <h3 className="settings-panel__section-title">{t('settingsPanel.agentEnv.title')}</h3>

      <div className="settings-panel__subsection-header" style={{ marginTop: 8 }}>
        <span>{t('settingsPanel.agentEnv.help')}</span>
      </div>

      {agentProviderOrder.map(provider => {
        const rows = (agentEnvByProvider[provider] ?? []) as AgentEnvRowDraft[]

        return (
          <div className="settings-provider-card" key={provider}>
            <div className="settings-provider-card__header">
              <strong className="settings-provider-card__title">
                {AGENT_PROVIDER_LABEL[provider]}
              </strong>
            </div>

            <div
              className="settings-list-container"
              data-testid={`settings-agent-env-list-${provider}`}
            >
              {rows.map((row, index) => (
                <div className="settings-list-item" key={row.id}>
                  <div className="settings-list-item__left" style={{ cursor: 'default' }}>
                    <label className="cove-toggle">
                      <input
                        type="checkbox"
                        data-testid={`settings-agent-env-enabled-${provider}-${row.id}`}
                        checked={row.enabled}
                        aria-label={t('settingsPanel.agentEnv.enabled')}
                        onChange={event => {
                          updateProviderRows(
                            provider,
                            rows.map(existing =>
                              existing.id === row.id
                                ? { ...existing, enabled: event.target.checked }
                                : existing,
                            ),
                          )
                        }}
                      />
                      <span className="cove-toggle__slider"></span>
                    </label>

                    <input
                      type="text"
                      className="cove-field"
                      value={row.key}
                      placeholder={t('settingsPanel.agentEnv.keyPlaceholder')}
                      onChange={event => {
                        updateProviderRows(
                          provider,
                          rows.map(existing =>
                            existing.id === row.id
                              ? { ...existing, key: event.target.value }
                              : existing,
                          ),
                        )
                      }}
                    />
                    <input
                      type="text"
                      className="cove-field"
                      value={row.value}
                      placeholder={t('settingsPanel.agentEnv.valuePlaceholder')}
                      onChange={event => {
                        updateProviderRows(
                          provider,
                          rows.map(existing =>
                            existing.id === row.id
                              ? { ...existing, value: event.target.value }
                              : existing,
                          ),
                        )
                      }}
                    />
                  </div>

                  <div className="settings-agent-order__actions">
                    <button
                      type="button"
                      className="secondary settings-agent-order__action"
                      data-testid={`settings-agent-env-move-up-${provider}-${row.id}`}
                      disabled={index === 0}
                      aria-label={t('settingsPanel.agent.moveUp')}
                      onClick={() => updateProviderRows(provider, moveItem(rows, index, index - 1))}
                    >
                      <ChevronUp className="settings-agent-order__icon" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="secondary settings-agent-order__action"
                      data-testid={`settings-agent-env-move-down-${provider}-${row.id}`}
                      disabled={index === rows.length - 1}
                      aria-label={t('settingsPanel.agent.moveDown')}
                      onClick={() => updateProviderRows(provider, moveItem(rows, index, index + 1))}
                    >
                      <ChevronDown className="settings-agent-order__icon" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      className="secondary settings-agent-order__action"
                      data-testid={`settings-agent-env-remove-${provider}-${row.id}`}
                      aria-label={t('common.remove')}
                      onClick={() => {
                        updateProviderRows(
                          provider,
                          rows.filter(existing => existing.id !== row.id),
                        )
                      }}
                    >
                      <Trash2 className="settings-agent-order__icon" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="primary"
                data-testid={`settings-agent-env-add-${provider}`}
                onClick={() => {
                  updateProviderRows(provider, [...rows, createRow()])
                }}
              >
                <Plus style={{ width: 14, height: 14, marginRight: 6 }} aria-hidden="true" />
                {t('settingsPanel.agentEnv.add')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
