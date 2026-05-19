import React, { useCallback, useEffect, useState } from 'react'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { useTranslation } from '@app/renderer/i18n'
import { toErrorMessage } from './workerSectionUtils'
import {
  AGENT_PROVIDER_LABEL,
  type AgentExecutablePathOverrideByProvider,
  type AgentProvider,
} from '@contexts/settings/domain/agentSettings'
import type { AgentProviderAvailability } from '@shared/contracts/dto'

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

export function AgentExecutableSection({
  agentProviderOrder,
  agentExecutablePathOverrideByProvider,
}: {
  agentProviderOrder: AgentProvider[]
  agentExecutablePathOverrideByProvider: AgentExecutablePathOverrideByProvider<AgentProvider>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [availabilityByProvider, setAvailabilityByProvider] = useState<
    Record<string, AgentProviderAvailability>
  >({})
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [installingProvider, setInstallingProvider] = useState<AgentProvider | null>(null)
  const [installErrorByProvider, setInstallErrorByProvider] = useState<Record<string, string>>({})

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

  const installProvider = useCallback(
    async (provider: AgentProvider): Promise<void> => {
      const install = window.opencoveApi?.agent?.installProvider
      if (typeof install !== 'function') {
        setInstallErrorByProvider(previous => ({
          ...previous,
          [provider]: t('settingsPanel.agentExecutable.installUnavailable'),
        }))
        return
      }

      setInstallingProvider(provider)
      setInstallErrorByProvider(previous => {
        const next = { ...previous }
        delete next[provider]
        return next
      })

      try {
        const result = await install({ provider })
        setAvailabilityByProvider(previous => ({
          ...previous,
          [provider]: result.availability,
        }))
        refreshAvailability()
      } catch (caughtError) {
        setInstallErrorByProvider(previous => ({
          ...previous,
          [provider]: toErrorMessage(caughtError),
        }))
      } finally {
        setInstallingProvider(current => (current === provider ? null : current))
      }
    },
    [refreshAvailability, t],
  )

  return (
    <div
      className="settings-panel__section settings-panel__section--vertical"
      id="settings-section-agent-executable"
    >
      <h3 className="settings-panel__section-title">{t('settingsPanel.agentExecutable.title')}</h3>

      <div className="settings-agent-install-list">
        {agentProviderOrder.map(provider => {
          const availability = availabilityByProvider[provider]
          const isInstallingProvider = installingProvider === provider
          const diagnostics = availability?.diagnostics?.join(' ') ?? ''
          const installError = installErrorByProvider[provider] ?? ''
          const isUnavailable = availability?.status === 'unavailable'
          const isMisconfigured = availability?.status === 'misconfigured'
          const isBusy = isRefreshing || Boolean(installingProvider)
          const actionLabel = resolveInstallActionLabel(availability, t, isInstallingProvider)
          const actionStatus = isInstallingProvider
            ? 'installing'
            : (availability?.status ?? 'loading')

          return (
            <div className="settings-agent-install-item" key={provider}>
              <div className="settings-agent-install-row">
                <div className="settings-agent-install-row__identity">
                  <AgentProviderIcon
                    provider={provider}
                    className="settings-agent-install-row__icon"
                  />
                  <strong className="settings-agent-install-row__name">
                    {AGENT_PROVIDER_LABEL[provider]}
                  </strong>
                </div>
                <button
                  type="button"
                  className="secondary settings-agent-install__button"
                  data-status={actionStatus}
                  data-testid={`settings-agent-executable-install-${provider}`}
                  aria-label={`${AGENT_PROVIDER_LABEL[provider]} ${actionLabel}`}
                  onClick={() => void installProvider(provider)}
                  disabled={!isUnavailable || isBusy}
                >
                  {actionLabel}
                </button>
              </div>

              {isMisconfigured && diagnostics.length > 0 ? (
                <div
                  className="settings-agent-install-item__error"
                  data-testid={`settings-agent-executable-diagnostics-${provider}`}
                >
                  {diagnostics}
                </div>
              ) : null}

              {installError.length > 0 ? (
                <div
                  className="settings-agent-install-item__error"
                  data-testid={`settings-agent-executable-install-error-${provider}`}
                >
                  {installError}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
