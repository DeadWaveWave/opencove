import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { useTerminalProfiles } from '@app/renderer/shell/hooks/useTerminalProfiles'
import { AI_NAMING_FEATURES } from '@shared/featureFlags/aiNaming'
import {
  AGENT_PROVIDERS,
  resolveTaskTitleProvider,
  type AgentProvider,
  type AgentSettings,
  type CanvasInputMode,
  type TaskTitleProvider,
  type UiLanguage,
  type UiTheme,
} from '@contexts/settings/domain/agentSettings'
import type { AppUpdateState } from '@shared/contracts/dto'
import { AgentSection } from './settingsPanel/AgentSection'
import { CanvasSection } from './settingsPanel/CanvasSection'
import { GeneralSection } from './settingsPanel/GeneralSection'
import { IntegrationsSection } from './settingsPanel/IntegrationsSection'
import { ModelOverrideSection } from './settingsPanel/ModelOverrideSection'
import { TaskConfigurationSection } from './settingsPanel/TaskConfigurationSection'
import { WorkspaceSection } from './settingsPanel/WorkspaceSection'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'

interface ProviderModelCatalogEntry {
  models: string[]
  source: string | null
  fetchedAt: string | null
  isLoading: boolean
  error: string | null
}

interface SettingsPanelProps {
  settings: AgentSettings
  updateState: AppUpdateState | null
  modelCatalogByProvider: Record<AgentProvider, ProviderModelCatalogEntry>
  workspaces: WorkspaceState[]
  onWorkspaceWorktreesRootChange: (workspaceId: string, worktreesRoot: string) => void
  onChange: (settings: AgentSettings) => void
  onCheckForUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onClose: () => void
}

type CorePageId = 'general' | 'agent' | 'canvas' | 'task-configuration' | 'integrations'
type WorkspacePageId = `workspace:${string}`
type SettingsPageId = CorePageId | WorkspacePageId

function getWorkspacePageId(workspaceId: string): WorkspacePageId {
  return `workspace:${workspaceId}`
}

function isWorkspacePageId(pageId: SettingsPageId): pageId is WorkspacePageId {
  return pageId.startsWith('workspace:')
}

function createInitialInputState(): Record<AgentProvider, string> {
  return AGENT_PROVIDERS.reduce<Record<AgentProvider, string>>(
    (acc, provider) => {
      acc[provider] = ''
      return acc
    },
    {} as Record<AgentProvider, string>,
  )
}

function getFolderName(path: string): string {
  const parts = path.split(/[/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export function SettingsPanel({
  settings,
  updateState,
  modelCatalogByProvider,
  workspaces,
  onWorkspaceWorktreesRootChange,
  onChange,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onClose,
}: SettingsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { terminalProfiles, detectedDefaultTerminalProfileId } = useTerminalProfiles()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [addModelInputByProvider, setAddModelInputByProvider] = useState<
    Record<AgentProvider, string>
  >(() => createInitialInputState())
  const [activePageId, setActivePageId] = useState<SettingsPageId>('general')
  const [addTaskTagInput, setAddTaskTagInput] = useState('')

  const updateDefaultProvider = (provider: AgentProvider): void =>
    onChange({ ...settings, defaultProvider: provider })
  const updateAgentProviderOrder = (providers: AgentProvider[]): void =>
    onChange({ ...settings, agentProviderOrder: providers })
  const updateLanguage = (language: UiLanguage): void => onChange({ ...settings, language })
  const updateUiTheme = (uiTheme: UiTheme): void => onChange({ ...settings, uiTheme })
  const updateAgentFullAccess = (enabled: boolean): void =>
    onChange({ ...settings, agentFullAccess: enabled })
  const updateDefaultTerminalProfileId = (profileId: string | null): void =>
    onChange({ ...settings, defaultTerminalProfileId: profileId })
  const updateTaskTitleProvider = (provider: TaskTitleProvider): void =>
    onChange({ ...settings, taskTitleProvider: provider })
  const updateTaskTitleModel = (model: string): void =>
    onChange({ ...settings, taskTitleModel: model })
  const updateNormalizeZoomOnTerminalClick = (enabled: boolean): void =>
    onChange({ ...settings, normalizeZoomOnTerminalClick: enabled })
  const updateCanvasInputMode = (mode: CanvasInputMode): void =>
    onChange({ ...settings, canvasInputMode: mode })
  const updateDefaultTerminalWindowScalePercent = (percent: number): void =>
    onChange({ ...settings, defaultTerminalWindowScalePercent: percent })
  const updateTerminalFontSize = (fontSize: number): void =>
    onChange({ ...settings, terminalFontSize: Math.round(fontSize) })
  const updateUiFontSize = (fontSize: number): void =>
    onChange({ ...settings, uiFontSize: fontSize })
  const updateUpdatePolicy = (policy: AgentSettings['updatePolicy']): void => {
    const normalized = settings.updateChannel === 'nightly' && policy === 'auto' ? 'prompt' : policy
    onChange({ ...settings, updatePolicy: normalized })
  }

  const updateUpdateChannel = (channel: AgentSettings['updateChannel']): void => {
    const normalizedPolicy =
      channel === 'nightly' && settings.updatePolicy === 'auto' ? 'prompt' : settings.updatePolicy
    onChange({ ...settings, updateChannel: channel, updatePolicy: normalizedPolicy })
  }
  const updateTaskTagOptions = (nextTags: string[]): void =>
    onChange({ ...settings, taskTagOptions: nextTags })
  const updateGitHubPullRequestsEnabled = (enabled: boolean): void =>
    onChange({ ...settings, githubPullRequestsEnabled: enabled })

  const removeTaskTagOption = (tag: string): void => {
    const nextTags = settings.taskTagOptions.filter(option => option !== tag)
    if (nextTags.length > 0) {
      updateTaskTagOptions(nextTags)
    }
  }

  const addTaskTagOption = (): void => {
    const candidate = addTaskTagInput.trim()
    if (candidate.length === 0) {
      return
    }

    const nextTags = settings.taskTagOptions.includes(candidate)
      ? settings.taskTagOptions
      : [...settings.taskTagOptions, candidate]
    updateTaskTagOptions(nextTags)
    setAddTaskTagInput('')
  }

  const updateProviderCustomModelEnabled = (provider: AgentProvider, enabled: boolean): void => {
    onChange({
      ...settings,
      customModelEnabledByProvider: {
        ...settings.customModelEnabledByProvider,
        [provider]: enabled,
      },
    })
  }

  const selectProviderModel = (provider: AgentProvider, model: string): void => {
    onChange({
      ...settings,
      customModelEnabledByProvider: { ...settings.customModelEnabledByProvider, [provider]: true },
      customModelByProvider: { ...settings.customModelByProvider, [provider]: model },
    })
  }

  const removeCustomModelOption = (provider: AgentProvider, model: string): void => {
    const currentOptions = settings.customModelOptionsByProvider[provider]
    if (!currentOptions.includes(model)) {
      return
    }

    const nextOptions = currentOptions.filter(option => option !== model)
    onChange({
      ...settings,
      customModelByProvider: {
        ...settings.customModelByProvider,
        [provider]:
          settings.customModelByProvider[provider] === model
            ? ''
            : settings.customModelByProvider[provider],
      },
      customModelOptionsByProvider: {
        ...settings.customModelOptionsByProvider,
        [provider]: nextOptions,
      },
    })
  }

  const updateAddModelInput = (provider: AgentProvider, value: string): void =>
    setAddModelInputByProvider(prev => ({ ...prev, [provider]: value }))

  const addCustomModelOption = (provider: AgentProvider): void => {
    const candidate = addModelInputByProvider[provider].trim()
    if (candidate.length === 0) {
      return
    }

    const existingOptions = settings.customModelOptionsByProvider[provider]
    const nextOptions = existingOptions.includes(candidate)
      ? existingOptions
      : [...existingOptions, candidate]
    onChange({
      ...settings,
      customModelEnabledByProvider: { ...settings.customModelEnabledByProvider, [provider]: true },
      customModelByProvider: { ...settings.customModelByProvider, [provider]: candidate },
      customModelOptionsByProvider: {
        ...settings.customModelOptionsByProvider,
        [provider]: nextOptions,
      },
    })
    setAddModelInputByProvider(prev => ({ ...prev, [provider]: '' }))
  }

  const effectiveTaskTitleProvider = useMemo(() => resolveTaskTitleProvider(settings), [settings])

  const activeWorkspace = useMemo(() => {
    if (!isWorkspacePageId(activePageId)) {
      return null
    }

    const workspaceId = activePageId.slice('workspace:'.length)
    return workspaces.find(workspace => workspace.id === workspaceId) ?? null
  }, [activePageId, workspaces])

  useEffect(() => {
    if (isWorkspacePageId(activePageId) && !activeWorkspace) {
      setActivePageId('general')
    }
  }, [activePageId, activeWorkspace])

  useEffect(() => {
    if (!contentRef.current) {
      return
    }

    contentRef.current.scrollTop = 0
  }, [activePageId])

  const NavButton = ({
    id,
    label,
    testId,
  }: {
    id: SettingsPageId
    label: string
    testId?: string
  }) => {
    const isActive = activePageId === id
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={() => setActivePageId(id)}
        className={`settings-panel__nav-button${isActive ? ' settings-panel__nav-button--active' : ''}`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section className="settings-panel" onClick={e => e.stopPropagation()}>
        <aside
          className="settings-panel__sidebar"
          aria-label={t('settingsPanel.nav.sectionsLabel')}
        >
          <NavButton
            id="general"
            label={t('settingsPanel.nav.general')}
            testId="settings-section-nav-general"
          />
          <NavButton
            id="agent"
            label={t('settingsPanel.nav.agent')}
            testId="settings-section-nav-agent"
          />
          <NavButton
            id="canvas"
            label={t('settingsPanel.nav.canvas')}
            testId="settings-section-nav-canvas"
          />
          <NavButton
            id="task-configuration"
            label={t('settingsPanel.nav.tasks')}
            testId="settings-section-nav-task-configuration"
          />
          <NavButton
            id="integrations"
            label={t('settingsPanel.nav.integrations')}
            testId="settings-section-nav-integrations"
          />

          <div className="settings-panel__nav-group-label">{t('settingsPanel.nav.projects')}</div>
          <div className="settings-panel__nav-group">
            {workspaces.map(workspace => (
              <NavButton
                key={workspace.id}
                id={getWorkspacePageId(workspace.id)}
                label={
                  workspace.name.trim().length > 0 ? workspace.name : getFolderName(workspace.path)
                }
              />
            ))}
          </div>
        </aside>

        <div className="settings-panel__content-wrapper">
          <div className="settings-panel__header">
            <h2>{t('settingsPanel.title')}</h2>
            <button type="button" className="settings-panel__close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="settings-panel__content" ref={contentRef}>
            {activePageId === 'general' ? (
              <GeneralSection
                language={settings.language}
                uiTheme={settings.uiTheme}
                uiFontSize={settings.uiFontSize}
                terminalFontSize={settings.terminalFontSize}
                updatePolicy={settings.updatePolicy}
                updateChannel={settings.updateChannel}
                updateState={updateState}
                onChangeLanguage={updateLanguage}
                onChangeUiTheme={updateUiTheme}
                onChangeUiFontSize={updateUiFontSize}
                onChangeTerminalFontSize={updateTerminalFontSize}
                onChangeUpdatePolicy={updateUpdatePolicy}
                onChangeUpdateChannel={updateUpdateChannel}
                onCheckForUpdates={onCheckForUpdates}
                onDownloadUpdate={onDownloadUpdate}
                onInstallUpdate={onInstallUpdate}
              />
            ) : null}

            {activePageId === 'agent' ? (
              <>
                <AgentSection
                  defaultProvider={settings.defaultProvider}
                  agentProviderOrder={settings.agentProviderOrder}
                  agentFullAccess={settings.agentFullAccess}
                  onChangeDefaultProvider={updateDefaultProvider}
                  onChangeAgentProviderOrder={updateAgentProviderOrder}
                  onChangeAgentFullAccess={updateAgentFullAccess}
                />
                <ModelOverrideSection
                  settings={settings}
                  modelCatalogByProvider={modelCatalogByProvider}
                  addModelInputByProvider={addModelInputByProvider}
                  onToggleCustomModelEnabled={updateProviderCustomModelEnabled}
                  onSelectProviderModel={selectProviderModel}
                  onRemoveCustomModelOption={removeCustomModelOption}
                  onChangeAddModelInput={updateAddModelInput}
                  onAddCustomModelOption={addCustomModelOption}
                />
              </>
            ) : null}

            {activePageId === 'integrations' ? (
              <IntegrationsSection
                githubPullRequestsEnabled={settings.githubPullRequestsEnabled}
                onChangeGitHubPullRequestsEnabled={updateGitHubPullRequestsEnabled}
              />
            ) : null}

            {activePageId === 'canvas' ? (
              <CanvasSection
                canvasInputMode={settings.canvasInputMode}
                normalizeZoomOnTerminalClick={settings.normalizeZoomOnTerminalClick}
                defaultTerminalWindowScalePercent={settings.defaultTerminalWindowScalePercent}
                defaultTerminalProfileId={settings.defaultTerminalProfileId}
                terminalProfiles={terminalProfiles}
                detectedDefaultTerminalProfileId={detectedDefaultTerminalProfileId}
                onChangeCanvasInputMode={updateCanvasInputMode}
                onChangeDefaultTerminalProfileId={updateDefaultTerminalProfileId}
                onChangeNormalizeZoomOnTerminalClick={updateNormalizeZoomOnTerminalClick}
                onChangeDefaultTerminalWindowScalePercent={updateDefaultTerminalWindowScalePercent}
              />
            ) : null}

            {activePageId === 'task-configuration' ? (
              <TaskConfigurationSection
                showTaskTitleGeneration={AI_NAMING_FEATURES.taskTitleGeneration}
                defaultProvider={settings.defaultProvider}
                taskTitleProvider={settings.taskTitleProvider}
                taskTitleModel={settings.taskTitleModel}
                effectiveTaskTitleProvider={effectiveTaskTitleProvider}
                tags={settings.taskTagOptions}
                addTaskTagInput={addTaskTagInput}
                onChangeTaskTitleProvider={updateTaskTitleProvider}
                onChangeTaskTitleModel={updateTaskTitleModel}
                onChangeAddTaskTagInput={setAddTaskTagInput}
                onAddTag={addTaskTagOption}
                onRemoveTag={removeTaskTagOption}
              />
            ) : null}

            {isWorkspacePageId(activePageId) && activeWorkspace ? (
              <WorkspaceSection
                sectionId={`settings-section-workspace-${activeWorkspace.id}`}
                workspaceName={activeWorkspace.name}
                workspacePath={activeWorkspace.path}
                worktreesRoot={activeWorkspace.worktreesRoot}
                onChangeWorktreesRoot={root =>
                  onWorkspaceWorktreesRootChange(activeWorkspace.id, root)
                }
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
