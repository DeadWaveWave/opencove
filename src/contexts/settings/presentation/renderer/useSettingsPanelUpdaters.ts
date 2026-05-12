import type {
  AgentProvider,
  AgentSettings,
  CanvasInputMode,
  CanvasWheelBehavior,
  CanvasWheelZoomModifier,
  FocusNodeTargetZoom,
  StandardWindowSizeBucket,
  TaskTitleProvider,
  UiLanguage,
  UiTheme,
} from '@contexts/settings/domain/agentSettings'
import type { SettingsPanelProps } from './SettingsPanel.shared'

export function createSettingsPanelUpdaters({
  settings,
  onChange,
}: Pick<SettingsPanelProps, 'settings' | 'onChange'>) {
  const updateSetting = <Key extends keyof AgentSettings>(
    key: Key,
    value: AgentSettings[Key],
  ): void => onChange({ ...settings, [key]: value })

  const updateUpdatePolicy = (policy: AgentSettings['updatePolicy']): void => {
    const normalized = settings.updateChannel === 'nightly' && policy === 'auto' ? 'prompt' : policy
    updateSetting('updatePolicy', normalized)
  }

  const updateUpdateChannel = (channel: AgentSettings['updateChannel']): void => {
    const normalizedPolicy =
      channel === 'nightly' && settings.updatePolicy === 'auto' ? 'prompt' : settings.updatePolicy
    onChange({ ...settings, updateChannel: channel, updatePolicy: normalizedPolicy })
  }

  return {
    updateDefaultProvider: (provider: AgentProvider): void =>
      updateSetting('defaultProvider', provider),
    updateAgentProviderOrder: (providers: AgentProvider[]): void =>
      updateSetting('agentProviderOrder', providers),
    updateLanguage: (language: UiLanguage): void => updateSetting('language', language),
    updateUiTheme: (uiTheme: UiTheme): void => updateSetting('uiTheme', uiTheme),
    updateAgentFullAccess: (enabled: boolean): void => updateSetting('agentFullAccess', enabled),
    updateDefaultTerminalProfileId: (profileId: string | null): void =>
      updateSetting('defaultTerminalProfileId', profileId),
    updateTaskTitleProvider: (provider: TaskTitleProvider): void =>
      updateSetting('taskTitleProvider', provider),
    updateTaskTitleModel: (model: string): void => updateSetting('taskTitleModel', model),
    updateFocusNodeOnClick: (enabled: boolean): void => updateSetting('focusNodeOnClick', enabled),
    updateFocusNodeTargetZoom: (zoom: FocusNodeTargetZoom): void =>
      updateSetting('focusNodeTargetZoom', zoom),
    updateFocusNodeUseVisibleCanvasCenter: (enabled: boolean): void =>
      updateSetting('focusNodeUseVisibleCanvasCenter', enabled),
    updateArchiveSpaceDeleteWorktreeByDefault: (enabled: boolean): void =>
      updateSetting('archiveSpaceDeleteWorktreeByDefault', enabled),
    updateArchiveSpaceDeleteBranchByDefault: (enabled: boolean): void =>
      updateSetting('archiveSpaceDeleteBranchByDefault', enabled),
    updateSystemNotificationsEnabled: (enabled: boolean): void =>
      updateSetting('systemNotificationsEnabled', enabled),
    updateStandbyBannerEnabled: (enabled: boolean): void =>
      updateSetting('standbyBannerEnabled', enabled),
    updateStandbyBannerShowTask: (enabled: boolean): void =>
      updateSetting('standbyBannerShowTask', enabled),
    updateStandbyBannerShowSpace: (enabled: boolean): void =>
      updateSetting('standbyBannerShowSpace', enabled),
    updateStandbyBannerShowBranch: (enabled: boolean): void =>
      updateSetting('standbyBannerShowBranch', enabled),
    updateStandbyBannerShowPullRequest: (enabled: boolean): void =>
      updateSetting('standbyBannerShowPullRequest', enabled),
    updateCanvasInputMode: (mode: CanvasInputMode): void => updateSetting('canvasInputMode', mode),
    updateCanvasWheelBehavior: (behavior: CanvasWheelBehavior): void =>
      updateSetting('canvasWheelBehavior', behavior),
    updateCanvasWheelZoomModifier: (modifier: CanvasWheelZoomModifier): void =>
      updateSetting('canvasWheelZoomModifier', modifier),
    updateStandardWindowSizeBucket: (bucket: StandardWindowSizeBucket): void =>
      updateSetting('standardWindowSizeBucket', bucket),
    updateWebsiteWindowPolicy: (policy: AgentSettings['websiteWindowPolicy']): void =>
      updateSetting('websiteWindowPolicy', policy),
    updateBrowserDefaultMode: (mode: AgentSettings['browserDefaultMode']): void =>
      updateSetting('browserDefaultMode', mode),
    updateBrowserSearchEngine: (engine: AgentSettings['browserSearchEngine']): void =>
      updateSetting('browserSearchEngine', engine),
    updateExperimentalWebsiteWindowPasteEnabled: (enabled: boolean): void =>
      updateSetting('experimentalWebsiteWindowPasteEnabled', enabled),
    updateExperimentalRemoteWorkersEnabled: (enabled: boolean): void =>
      updateSetting('experimentalRemoteWorkersEnabled', enabled),
    updateTerminalFontSize: (fontSize: number): void =>
      updateSetting('terminalFontSize', Math.round(fontSize)),
    updateTerminalFontFamily: (family: string | null): void =>
      updateSetting('terminalFontFamily', family),
    updateTerminalAutoReference: (enabled: boolean): void =>
      updateSetting('terminalDisplayAutoReferenceEnabled', enabled),
    updateTerminalCompensation: (enabled: boolean): void =>
      updateSetting('terminalDisplayCalibrationCompensationEnabled', enabled),
    updateTerminalDisplayReference: (reference: AgentSettings['terminalDisplayReference']): void =>
      updateSetting('terminalDisplayReference', reference),
    updateUiFontSize: (fontSize: number): void => updateSetting('uiFontSize', fontSize),
    updateUpdatePolicy,
    updateUpdateChannel,
    updateTaskTagOptions: (taskTagOptions: string[]): void =>
      updateSetting('taskTagOptions', taskTagOptions),
    updateQuickCommands: (quickCommands: AgentSettings['quickCommands']): void =>
      updateSetting('quickCommands', quickCommands),
    updateQuickPhrases: (quickPhrases: AgentSettings['quickPhrases']): void =>
      updateSetting('quickPhrases', quickPhrases),
    updateAgentEnvByProvider: (agentEnvByProvider: AgentSettings['agentEnvByProvider']): void =>
      updateSetting('agentEnvByProvider', agentEnvByProvider),
    updateAgentExecutablePathOverrideByProvider: (
      agentExecutablePathOverrideByProvider: AgentSettings['agentExecutablePathOverrideByProvider'],
    ): void =>
      updateSetting('agentExecutablePathOverrideByProvider', agentExecutablePathOverrideByProvider),
    updateDisableAppShortcutsWhenTerminalFocused: (enabled: boolean): void =>
      updateSetting('disableAppShortcutsWhenTerminalFocused', enabled),
    updateKeybindings: (keybindings: AgentSettings['keybindings']): void =>
      updateSetting('keybindings', keybindings),
    updateGitHubPullRequestsEnabled: (enabled: boolean): void =>
      updateSetting('githubPullRequestsEnabled', enabled),
    updatePerformanceMonitorHeaderButtonEnabled: (enabled: boolean): void =>
      updateSetting('performanceMonitorHeaderButtonEnabled', enabled),
  }
}
