import type { AgentProvider, AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { AgentProviderAvailability } from '@shared/contracts/dto'
import type { TranslateFn } from '@app/renderer/i18n'

export function resolveModelSummary(
  settings: AgentSettings,
  provider: AgentProvider,
  t: TranslateFn,
): string {
  const customModel = settings.customModelByProvider[provider]?.trim() ?? ''
  if (settings.customModelEnabledByProvider[provider] && customModel.length > 0) {
    return customModel
  }

  return t('common.defaultFollowCli')
}

export function resolveEnvSummary(
  settings: AgentSettings,
  provider: AgentProvider,
  t: TranslateFn,
): string {
  const count = (settings.agentEnvByProvider[provider] ?? []).filter(
    row => row.key.trim().length > 0,
  ).length

  if (count === 0) {
    return t('settingsPanel.agent.envSummaryNone')
  }

  return t('settingsPanel.agent.envSummary', { count })
}

export function resolveInstallActionLabel(
  availability: AgentProviderAvailability | null | undefined,
  t: TranslateFn,
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
