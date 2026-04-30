import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
  type AgentExecutablePathOverrideByProvider,
  type AgentProvider,
} from '@contexts/settings/domain/agentSettings'
import type { AgentProviderAvailability } from '@shared/contracts/dto'

function resolveAvailabilityLabel(
  availability: AgentProviderAvailability | null | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (!availability) {
    return t('common.loading')
  }

  if (availability.status === 'available') {
    return t('settingsPanel.agentExecutable.status.available')
  }

  if (availability.status === 'misconfigured') {
    return t('settingsPanel.agentExecutable.status.misconfigured')
  }

  return t('settingsPanel.agentExecutable.status.unavailable')
}

export function AgentExecutableSection({
  agentProviderOrder,
  agentExecutablePathOverrideByProvider,
  onChangeAgentExecutablePathOverrideByProvider,
}: {
  agentProviderOrder: AgentProvider[]
  agentExecutablePathOverrideByProvider: AgentExecutablePathOverrideByProvider<AgentProvider>
  onChangeAgentExecutablePathOverrideByProvider: (
    next: AgentExecutablePathOverrideByProvider<AgentProvider>,
  ) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [availabilityByProvider, setAvailabilityByProvider] = useState<
    Record<string, AgentProviderAvailability>
  >({})
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refreshAvailability = useCallback(() => {
    const listInstalledProviders = window.opencoveApi?.agent?.listInstalledProviders
    if (typeof listInstalledProviders !== 'function') {
      setAvailabilityByProvider({})
      setIsRefreshing(false)
      return
    }

    setIsRefreshing(true)

    listInstalledProviders({
      executablePathOverrideByProvider: agentExecutablePathOverrideByProvider,
    })
      .then(result => {
        setAvailabilityByProvider(result.availabilityByProvider)
      })
      .catch(() => {
        setAvailabilityByProvider({})
      })
      .finally(() => {
        setIsRefreshing(false)
      })
  }, [agentExecutablePathOverrideByProvider])

  useEffect(() => {
    refreshAvailability()
  }, [refreshAvailability])

  return (
    <div
      className="settings-panel__section settings-panel__section--vertical"
      id="settings-section-agent-executable"
    >
      <h3 className="settings-panel__section-title">{t('settingsPanel.agentExecutable.title')}</h3>

      <div className="settings-panel__subsection-header" style={{ marginTop: 8 }}>
        <span>{t('settingsPanel.agentExecutable.help')}</span>
        <button
          type="button"
          className="secondary"
          data-testid="settings-agent-executable-refresh"
          onClick={refreshAvailability}
          disabled={isRefreshing}
        >
          {isRefreshing ? t('common.loading') : t('common.refresh')}
        </button>
      </div>

      {agentProviderOrder.map(provider => {
        const availability = availabilityByProvider[provider]
        const diagnostics = availability?.diagnostics?.join(' ') ?? ''
        const resolvedExecutablePath = availability?.executablePath?.trim() ?? ''
        const executablePath =
          resolvedExecutablePath.length > 0
            ? resolvedExecutablePath
            : t('settingsPanel.agentExecutable.notResolved')

        return (
          <div className="settings-provider-card" key={provider}>
            <div className="settings-provider-card__header">
              <strong className="settings-provider-card__title">
                {AGENT_PROVIDER_LABEL[provider]}
              </strong>
              <span data-testid={`settings-agent-executable-status-${provider}`}>
                {resolveAvailabilityLabel(availability, t)}
              </span>
            </div>

            <div className="settings-panel__subsection-header" style={{ marginTop: 0 }}>
              <span>
                {t('settingsPanel.agentExecutable.commandLabel', {
                  command: availability?.command ?? '',
                })}
              </span>
            </div>

            <div className="settings-panel__row" style={{ marginTop: 12 }}>
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.agentExecutable.overrideLabel')}</strong>
                <span>{t('settingsPanel.agentExecutable.overrideHelp')}</span>
              </div>
              <div className="settings-panel__control">
                <input
                  type="text"
                  className="cove-field"
                  data-testid={`settings-agent-executable-override-${provider}`}
                  value={agentExecutablePathOverrideByProvider[provider] ?? ''}
                  placeholder={t('settingsPanel.agentExecutable.overridePlaceholder')}
                  onChange={event => {
                    onChangeAgentExecutablePathOverrideByProvider({
                      ...agentExecutablePathOverrideByProvider,
                      [provider]: event.target.value,
                    })
                  }}
                />
              </div>
            </div>

            <div className="settings-panel__subsection-header" style={{ marginTop: 12 }}>
              <span>
                {t('settingsPanel.agentExecutable.pathLabel')}: {executablePath}
              </span>
            </div>

            {diagnostics.length > 0 ? (
              <div
                className="settings-provider-card__error"
                data-testid={`settings-agent-executable-diagnostics-${provider}`}
              >
                {diagnostics}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
