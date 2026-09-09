import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, GripVertical } from 'lucide-react'
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

export function AgentSortableRow({
  provider,
  isDefault,
  settings,
  availability,
  isInstalling,
  isBusy,
  installError,
  onConfigure,
  onInstall,
}: {
  provider: AgentProvider
  isDefault: boolean
  settings: AgentSettings
  availability?: AgentProviderAvailability
  isInstalling: boolean
  isBusy: boolean
  installError?: string
  onConfigure: (provider: AgentProvider) => void
  onInstall: (provider: AgentProvider) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider })
  const name = AGENT_PROVIDER_LABEL[provider]
  const reorderLabel = t('settingsPanel.agent.reorderLabel', { provider: name })
  const installLabel = resolveInstallActionLabel(availability, t, isInstalling)
  const modelSummary = resolveModelSummary(settings, provider, t)
  const error =
    installError ||
    (availability?.status === 'misconfigured' ? availability.diagnostics?.join(' ') : '')

  return (
    <div
      ref={setNodeRef}
      className="settings-agent-list-item"
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div
        className="settings-list-item settings-agent-list-row"
        data-testid={`settings-agent-order-item-${provider}`}
        data-default={isDefault || undefined}
      >
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="settings-agent-drag-handle"
          data-testid={`settings-agent-drag-handle-${provider}`}
          {...attributes}
          {...listeners}
          aria-label={reorderLabel}
          title={reorderLabel}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="settings-agent-identity"
          data-testid={`settings-agent-configure-${provider}`}
          aria-label={`${name} ${t('settingsPanel.agent.configure')}`}
          onClick={() => onConfigure(provider)}
        >
          <AgentProviderIcon provider={provider} className="settings-agent-list-row__icon" />
          <span className="settings-agent-identity__text">
            <span className="settings-agent-identity__name">
              <strong className="settings-agent-list-row__name">{name}</strong>
              {isDefault ? (
                <span className="settings-agent-list-row__default">
                  {t('settingsPanel.agent.defaultBadge')}
                </span>
              ) : null}
            </span>
            <span className="settings-agent-list-row__summary">
              <span title={modelSummary}>{modelSummary}</span>
              <span>{resolveEnvSummary(settings, provider, t)}</span>
            </span>
          </span>
          <ChevronRight size={15} className="settings-agent-identity__chevron" aria-hidden="true" />
        </button>
        <div className="settings-agent-list-row__actions">
          <button
            type="button"
            className="secondary settings-agent-install__button"
            data-status={isInstalling ? 'installing' : (availability?.status ?? 'loading')}
            data-testid={`settings-agent-executable-install-${provider}`}
            aria-label={`${name} ${installLabel}`}
            onClick={() => onInstall(provider)}
            disabled={availability?.status !== 'unavailable' || isBusy}
          >
            {installLabel}
          </button>
        </div>
      </div>
      {error ? (
        <div
          className="settings-agent-install-item__error"
          data-testid={`settings-agent-executable-${installError ? 'install-error' : 'diagnostics'}-${provider}`}
        >
          {error}
        </div>
      ) : null}
    </div>
  )
}
