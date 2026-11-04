import React, { useRef } from 'react'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
  type AgentProvider,
  type AgentSettings,
} from '@contexts/settings/domain/agentSettings'
import type { AgentProviderAvailability } from '@shared/contracts/dto'
import { AgentSortableRow } from './AgentSortableRow'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export function AgentSection({
  defaultProvider,
  agentProviderOrder,
  agentFullAccess,
  availabilityByProvider,
  installingProvider,
  installErrorByProvider,
  isRefreshingAvailability,
  settings,
  onChangeAgentProviderOrder,
  onChangeAgentFullAccess,
  onInstallProvider,
  onConfigureProvider,
  onRefreshAvailability,
}: {
  defaultProvider: AgentProvider
  agentProviderOrder: AgentProvider[]
  agentFullAccess: boolean
  availabilityByProvider: Record<string, AgentProviderAvailability>
  installingProvider: AgentProvider | null
  installErrorByProvider: Record<string, string>
  isRefreshingAvailability: boolean
  settings: AgentSettings
  onChangeAgentProviderOrder: (providers: AgentProvider[]) => void
  onChangeAgentFullAccess: (enabled: boolean) => void
  onInstallProvider: (provider: AgentProvider) => void
  onConfigureProvider: (provider: AgentProvider) => void
  onRefreshAvailability: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isSortingRef = useRef(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    isSortingRef.current = false
    if (!over || active.id === over.id) {
      return
    }
    const from = agentProviderOrder.indexOf(active.id as AgentProvider)
    const to = agentProviderOrder.indexOf(over.id as AgentProvider)
    if (from < 0 || to < 0) {
      return
    }
    onChangeAgentProviderOrder(arrayMove(agentProviderOrder, from, to))
  }
  const label = (id: string | number) => AGENT_PROVIDER_LABEL[id as AgentProvider] ?? String(id)
  const position = (id: string | number) => agentProviderOrder.indexOf(id as AgentProvider) + 1

  return (
    <>
      <SettingsGroup
        id="settings-section-agent"
        title={t('settingsPanel.groups.agent.providers')}
        description={t('settingsPanel.agent.agentProviderOrderHelp')}
      >
        <div
          className="settings-agent-list-block"
          id="settings-agent-list"
          onKeyDown={event => {
            if (event.key === 'Escape' && isSortingRef.current) {
              event.preventDefault()
            }
          }}
        >
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            onDragStart={() => {
              isSortingRef.current = true
            }}
            onDragCancel={() => {
              isSortingRef.current = false
            }}
            accessibility={{
              screenReaderInstructions: { draggable: t('settingsPanel.agent.reorderInstructions') },
              announcements: {
                onDragStart: ({ active }) =>
                  t('settingsPanel.agent.reorderStarted', {
                    provider: label(active.id),
                    position: position(active.id),
                  }),
                onDragOver: ({ active, over }) =>
                  over
                    ? t('settingsPanel.agent.reorderMoved', {
                        provider: label(active.id),
                        position: position(over.id),
                      })
                    : undefined,
                onDragEnd: ({ active, over }) =>
                  t(
                    over
                      ? 'settingsPanel.agent.reorderDropped'
                      : 'settingsPanel.agent.reorderCancelled',
                    { provider: label(active.id), position: position(over?.id ?? active.id) },
                  ),
                onDragCancel: ({ active }) =>
                  t('settingsPanel.agent.reorderCancelled', { provider: label(active.id) }),
              },
            }}
          >
            <SortableContext items={agentProviderOrder} strategy={verticalListSortingStrategy}>
              <div className="settings-list-container">
                {agentProviderOrder.map(provider => (
                  <AgentSortableRow
                    key={provider}
                    provider={provider}
                    isDefault={defaultProvider === provider}
                    settings={settings}
                    availability={availabilityByProvider[provider]}
                    isInstalling={installingProvider === provider}
                    isBusy={isRefreshingAvailability || Boolean(installingProvider)}
                    installError={installErrorByProvider[provider]}
                    onConfigure={onConfigureProvider}
                    onInstall={onInstallProvider}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
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
              <span
                data-testid="settings-agent-full-access-help"
                data-tone={agentFullAccess ? 'warning' : undefined}
              >
                {agentFullAccess
                  ? t('settingsPanel.agent.fullAccessOnHelp')
                  : t('settingsPanel.agent.fullAccessOffHelp')}
              </span>
            </div>
            <div className="settings-panel__control">
              <Toggle
                data-testid="settings-agent-full-access"
                checked={agentFullAccess}
                label={t('settingsPanel.agent.fullAccessLabel')}
                onCheckedChange={checked => onChangeAgentFullAccess(checked)}
              />
            </div>
          </div>
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
