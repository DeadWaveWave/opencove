import type {
  AppUpdateChannel,
  AppUpdatePolicy,
  WebsiteWindowPolicy,
} from '../../../shared/contracts/dto'
import type {
  AgentCustomModelByProvider,
  AgentCustomModelEnabledByProvider,
  AgentCustomModelOptionsByProvider,
} from './agentSettings.customModels'
import {
  AGENT_PROVIDERS,
  isTaskTitleAgentProvider,
  isValidProvider,
  normalizeAgentProviderOrder,
  type AgentProvider,
  type TaskTitleAgentProvider,
} from './agentSettings.providers'
import { normalizeFocusNodeTargetZoom, type FocusNodeTargetZoom } from './focusNodeTargetZoom'
import { isValidUiLanguage, isValidUiTheme, type UiLanguage, type UiTheme } from './uiSettings'
import {
  isValidUpdateChannel,
  isValidUpdatePolicy,
  normalizeUpdatePolicyForChannel,
} from './updateSettings'
import type { KeybindingOverrides } from './keybindings'
import { normalizeKeybindingOverrides } from './keybindings'
import {
  isValidCanvasInputMode,
  isValidCanvasWheelBehavior,
  isValidCanvasWheelZoomModifier,
  isValidStandardWindowSizeBucket,
  type CanvasInputMode,
  type CanvasWheelBehavior,
  type CanvasWheelZoomModifier,
  type StandardWindowSizeBucket,
} from './canvasSettings'
import {
  isRecord,
  normalizeBoolean,
  normalizeIntegerInRange,
  normalizeTextValue,
  normalizeUniqueStringArray,
  normalizeUniqueStringArrayWithFallback,
} from './settingsNormalization'
import type { TaskPromptTemplate, TaskPromptTemplatesByWorkspaceId } from './taskPromptTemplates'
import {
  normalizeTaskPromptTemplates,
  normalizeTaskPromptTemplatesByWorkspaceId,
} from './taskPromptTemplates'
import type { QuickCommand } from './quickCommands'
import { normalizeQuickCommands } from './quickCommands'
import type { QuickPhrase } from './quickPhrases'
import { normalizeQuickPhrases } from './quickPhrases'
import type { AgentEnvByProvider } from './agentEnv'
import { normalizeAgentEnvByProvider } from './agentEnv'
import { normalizeWebsiteWindowPolicy } from './websiteWindowSettings'
import { DEFAULT_AGENT_SETTINGS } from './agentSettings.defaults'

export {
  FOCUS_NODE_TARGET_ZOOM_STEP,
  MAX_FOCUS_NODE_TARGET_ZOOM,
  MIN_FOCUS_NODE_TARGET_ZOOM,
} from './focusNodeTargetZoom'
export type { FocusNodeTargetZoom } from './focusNodeTargetZoom'
export {
  AGENT_PROVIDERS,
  EXPERIMENTAL_AGENT_PROVIDERS,
  TASK_TITLE_PROVIDERS,
  WORKTREE_NAME_SUGGESTION_PROVIDERS,
  isTaskTitleAgentProvider,
  isWorktreeNameSuggestionProvider,
} from './agentSettings.providers'
export type {
  AgentProvider,
  TaskTitleAgentProvider,
  WorktreeNameSuggestionAgentProvider,
} from './agentSettings.providers'
export type TaskTitleProvider = 'default' | TaskTitleAgentProvider
export {
  CANVAS_INPUT_MODES,
  CANVAS_WHEEL_BEHAVIORS,
  CANVAS_WHEEL_ZOOM_MODIFIERS,
  STANDARD_WINDOW_SIZE_BUCKETS,
} from './canvasSettings'
export type {
  CanvasInputMode,
  CanvasWheelBehavior,
  CanvasWheelZoomModifier,
  StandardWindowSizeBucket,
} from './canvasSettings'
export {
  DEFAULT_UI_LANGUAGE,
  UI_LANGUAGES,
  UI_THEME_DESCRIPTORS,
  UI_THEMES,
  resolveUiThemeBaseScheme,
} from './uiSettings'
export type { UiLanguage, UiTheme, UiThemeBaseScheme, UiThemeDescriptor } from './uiSettings'

export type TerminalProfileId = string | null
export const MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT = 60
export const MAX_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT = 120
export const MIN_TERMINAL_FONT_SIZE = 10
export const MAX_TERMINAL_FONT_SIZE = 22
export const MIN_UI_FONT_SIZE = 14
export const MAX_UI_FONT_SIZE = 24
export const MIN_WORKSPACE_SEARCH_PANEL_WIDTH = 320
export const MAX_WORKSPACE_SEARCH_PANEL_WIDTH = 720

const MIN_LEGACY_UI_FONT_SCALE_PERCENT = 85
const MAX_LEGACY_UI_FONT_SCALE_PERCENT = 140

export {
  AGENT_PROVIDER_CAPABILITIES,
  AGENT_PROVIDER_LABEL,
  type AgentProviderCapabilities,
} from './agentSettings.providerMeta'
export { UI_LANGUAGE_NATIVE_LABEL } from './agentSettings.uiLanguage'

export type { TaskPromptTemplate, TaskPromptTemplatesByWorkspaceId } from './taskPromptTemplates'
export type { QuickCommand } from './quickCommands'
export type { QuickPhrase } from './quickPhrases'
export type { AgentEnvByProvider, AgentEnvRow } from './agentEnv'
export {
  resolveAgentLaunchEnv,
  resolveAgentModel,
  resolveTaskTitleModel,
  resolveTaskTitleProvider,
  resolveWorktreeNameSuggestionProvider,
} from './agentSettings.resolvers'

export interface AgentSettings {
  language: UiLanguage
  uiTheme: UiTheme
  isPrimarySidebarCollapsed: boolean
  workspaceSearchPanelWidth: number
  defaultProvider: AgentProvider
  agentProviderOrder: AgentProvider[]
  agentFullAccess: boolean
  defaultTerminalProfileId: TerminalProfileId
  customModelEnabledByProvider: AgentCustomModelEnabledByProvider<AgentProvider>
  customModelByProvider: AgentCustomModelByProvider<AgentProvider>
  customModelOptionsByProvider: AgentCustomModelOptionsByProvider<AgentProvider>
  taskTitleProvider: TaskTitleProvider
  taskTitleModel: string
  taskTagOptions: string[]
  taskPromptTemplates: TaskPromptTemplate[]
  taskPromptTemplatesByWorkspaceId: TaskPromptTemplatesByWorkspaceId
  quickCommands: QuickCommand[]
  quickPhrases: QuickPhrase[]
  agentEnvByProvider: AgentEnvByProvider
  focusNodeOnClick: boolean
  focusNodeTargetZoom: FocusNodeTargetZoom
  focusNodeUseVisibleCanvasCenter: boolean
  standbyBannerEnabled: boolean
  standbyBannerShowTask: boolean
  standbyBannerShowSpace: boolean
  standbyBannerShowBranch: boolean
  standbyBannerShowPullRequest: boolean
  disableAppShortcutsWhenTerminalFocused: boolean
  keybindings: KeybindingOverrides
  canvasInputMode: CanvasInputMode
  canvasWheelBehavior: CanvasWheelBehavior
  canvasWheelZoomModifier: CanvasWheelZoomModifier
  standardWindowSizeBucket: StandardWindowSizeBucket
  websiteWindowPolicy: WebsiteWindowPolicy
  experimentalWebsiteWindowPasteEnabled: boolean
  experimentalRemoteWorkersEnabled: boolean
  defaultTerminalWindowScalePercent: number
  terminalFontSize: number
  terminalFontFamily: string | null
  uiFontSize: number
  githubPullRequestsEnabled: boolean
  updatePolicy: AppUpdatePolicy
  updateChannel: AppUpdateChannel
  releaseNotesSeenVersion: string | null
  hideWorktreeMismatchDropWarning: boolean
}
export { DEFAULT_AGENT_SETTINGS }

function isValidTaskTitleProvider(value: unknown): value is TaskTitleProvider {
  return value === 'default' || isTaskTitleAgentProvider(value)
}

export function normalizeAgentSettings(value: unknown): AgentSettings {
  if (!isRecord(value)) {
    return DEFAULT_AGENT_SETTINGS
  }

  const defaultProvider = isValidProvider(value.defaultProvider)
    ? value.defaultProvider
    : DEFAULT_AGENT_SETTINGS.defaultProvider
  const language = isValidUiLanguage(value.language)
    ? value.language
    : DEFAULT_AGENT_SETTINGS.language
  const uiTheme = isValidUiTheme(value.uiTheme) ? value.uiTheme : DEFAULT_AGENT_SETTINGS.uiTheme
  const isPrimarySidebarCollapsed =
    normalizeBoolean(value.isPrimarySidebarCollapsed) ??
    DEFAULT_AGENT_SETTINGS.isPrimarySidebarCollapsed
  const workspaceSearchPanelWidth = normalizeIntegerInRange(
    value.workspaceSearchPanelWidth,
    DEFAULT_AGENT_SETTINGS.workspaceSearchPanelWidth,
    MIN_WORKSPACE_SEARCH_PANEL_WIDTH,
    MAX_WORKSPACE_SEARCH_PANEL_WIDTH,
  )
  const agentProviderOrder = normalizeAgentProviderOrder(value.agentProviderOrder)

  const agentFullAccess =
    normalizeBoolean(value.agentFullAccess) ?? DEFAULT_AGENT_SETTINGS.agentFullAccess
  const defaultTerminalProfileId = normalizeTextValue(value.defaultTerminalProfileId)

  const enabledInput = isRecord(value.customModelEnabledByProvider)
    ? value.customModelEnabledByProvider
    : {}

  const customModelInput = isRecord(value.customModelByProvider) ? value.customModelByProvider : {}

  const legacyModelInput = isRecord(value.modelByProvider) ? value.modelByProvider : {}

  const customModelEnabledByProvider = AGENT_PROVIDERS.reduce<
    AgentCustomModelEnabledByProvider<AgentProvider>
  >(
    (acc, provider) => {
      const normalizedEnabled = normalizeBoolean(enabledInput[provider])
      const legacyModel = normalizeTextValue(legacyModelInput[provider])

      acc[provider] = normalizedEnabled === null ? legacyModel.length > 0 : normalizedEnabled

      return acc
    },
    { ...DEFAULT_AGENT_SETTINGS.customModelEnabledByProvider },
  )

  const customModelByProvider = AGENT_PROVIDERS.reduce<AgentCustomModelByProvider<AgentProvider>>(
    (acc, provider) => {
      const current = customModelInput[provider] ?? legacyModelInput[provider]
      acc[provider] = normalizeTextValue(current)
      return acc
    },
    { ...DEFAULT_AGENT_SETTINGS.customModelByProvider },
  )

  const optionsInput = isRecord(value.customModelOptionsByProvider)
    ? value.customModelOptionsByProvider
    : {}

  const customModelOptionsByProvider = AGENT_PROVIDERS.reduce<
    AgentCustomModelOptionsByProvider<AgentProvider>
  >(
    (acc, provider) => {
      const options = normalizeUniqueStringArray(optionsInput[provider])
      const selectedModel = customModelByProvider[provider]

      if (selectedModel.length > 0 && !options.includes(selectedModel)) {
        options.unshift(selectedModel)
      }

      acc[provider] = options
      return acc
    },
    AGENT_PROVIDERS.reduce<AgentCustomModelOptionsByProvider<AgentProvider>>(
      (acc, provider) => {
        acc[provider] = [...DEFAULT_AGENT_SETTINGS.customModelOptionsByProvider[provider]]
        return acc
      },
      { ...DEFAULT_AGENT_SETTINGS.customModelOptionsByProvider },
    ),
  )

  const taskTitleProvider = isValidTaskTitleProvider(value.taskTitleProvider)
    ? value.taskTitleProvider
    : DEFAULT_AGENT_SETTINGS.taskTitleProvider

  const taskTitleModel = normalizeTextValue(value.taskTitleModel)
  const taskTagOptions = normalizeUniqueStringArrayWithFallback(
    value.taskTagOptions,
    DEFAULT_AGENT_SETTINGS.taskTagOptions,
  )
  const taskPromptTemplates = normalizeTaskPromptTemplates(value.taskPromptTemplates)
  const taskPromptTemplatesByWorkspaceId = normalizeTaskPromptTemplatesByWorkspaceId(
    value.taskPromptTemplatesByWorkspaceId,
  )
  const quickCommands = normalizeQuickCommands(value.quickCommands)
  const quickPhrases = normalizeQuickPhrases(value.quickPhrases)
  const agentEnvByProvider = normalizeAgentEnvByProvider(value.agentEnvByProvider)
  const focusNodeOnClick =
    normalizeBoolean(value.focusNodeOnClick) ??
    normalizeBoolean(value.normalizeZoomOnTerminalClick) ??
    DEFAULT_AGENT_SETTINGS.focusNodeOnClick
  const focusNodeTargetZoom = normalizeFocusNodeTargetZoom(
    value.focusNodeTargetZoom,
    DEFAULT_AGENT_SETTINGS.focusNodeTargetZoom,
  )
  const focusNodeUseVisibleCanvasCenter =
    normalizeBoolean(value.focusNodeUseVisibleCanvasCenter) ??
    DEFAULT_AGENT_SETTINGS.focusNodeUseVisibleCanvasCenter
  const standbyBannerEnabled =
    normalizeBoolean(value.standbyBannerEnabled) ?? DEFAULT_AGENT_SETTINGS.standbyBannerEnabled
  const standbyBannerShowTask =
    normalizeBoolean(value.standbyBannerShowTask) ?? DEFAULT_AGENT_SETTINGS.standbyBannerShowTask
  const standbyBannerShowSpace =
    normalizeBoolean(value.standbyBannerShowSpace) ?? DEFAULT_AGENT_SETTINGS.standbyBannerShowSpace
  const standbyBannerShowBranch =
    normalizeBoolean(value.standbyBannerShowBranch) ??
    DEFAULT_AGENT_SETTINGS.standbyBannerShowBranch
  const standbyBannerShowPullRequest =
    normalizeBoolean(value.standbyBannerShowPullRequest) ??
    DEFAULT_AGENT_SETTINGS.standbyBannerShowPullRequest
  const disableAppShortcutsWhenTerminalFocused =
    normalizeBoolean(value.disableAppShortcutsWhenTerminalFocused) ??
    DEFAULT_AGENT_SETTINGS.disableAppShortcutsWhenTerminalFocused
  const keybindings = normalizeKeybindingOverrides(value.keybindings)
  const canvasInputMode = isValidCanvasInputMode(value.canvasInputMode)
    ? value.canvasInputMode
    : DEFAULT_AGENT_SETTINGS.canvasInputMode
  const canvasWheelBehavior = isValidCanvasWheelBehavior(value.canvasWheelBehavior)
    ? value.canvasWheelBehavior
    : DEFAULT_AGENT_SETTINGS.canvasWheelBehavior
  const canvasWheelZoomModifier = isValidCanvasWheelZoomModifier(value.canvasWheelZoomModifier)
    ? value.canvasWheelZoomModifier
    : DEFAULT_AGENT_SETTINGS.canvasWheelZoomModifier
  const standardWindowSizeBucket = isValidStandardWindowSizeBucket(value.standardWindowSizeBucket)
    ? value.standardWindowSizeBucket
    : DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket
  const websiteWindowPolicy = normalizeWebsiteWindowPolicy(
    value.websiteWindowPolicy,
    DEFAULT_AGENT_SETTINGS.websiteWindowPolicy,
  )
  const experimentalWebsiteWindowPasteEnabled =
    normalizeBoolean(value.experimentalWebsiteWindowPasteEnabled) ??
    DEFAULT_AGENT_SETTINGS.experimentalWebsiteWindowPasteEnabled
  const experimentalRemoteWorkersEnabled =
    normalizeBoolean(value.experimentalRemoteWorkersEnabled) ??
    DEFAULT_AGENT_SETTINGS.experimentalRemoteWorkersEnabled
  const defaultTerminalWindowScalePercent = normalizeIntegerInRange(
    value.defaultTerminalWindowScalePercent,
    DEFAULT_AGENT_SETTINGS.defaultTerminalWindowScalePercent,
    MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
    MAX_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
  )
  const terminalFontSize = normalizeIntegerInRange(
    value.terminalFontSize,
    DEFAULT_AGENT_SETTINGS.terminalFontSize,
    MIN_TERMINAL_FONT_SIZE,
    MAX_TERMINAL_FONT_SIZE,
  )
  const terminalFontFamily =
    typeof value.terminalFontFamily === 'string' && value.terminalFontFamily.trim().length > 0
      ? value.terminalFontFamily.trim()
      : DEFAULT_AGENT_SETTINGS.terminalFontFamily
  const legacyUiFontScalePercent = normalizeIntegerInRange(
    value.uiFontScalePercent,
    Math.round((DEFAULT_AGENT_SETTINGS.uiFontSize / 16) * 100),
    MIN_LEGACY_UI_FONT_SCALE_PERCENT,
    MAX_LEGACY_UI_FONT_SCALE_PERCENT,
  )
  const fallbackUiFontSize = Math.round((legacyUiFontScalePercent / 100) * 16)
  const uiFontSize = normalizeIntegerInRange(
    value.uiFontSize,
    fallbackUiFontSize,
    MIN_UI_FONT_SIZE,
    MAX_UI_FONT_SIZE,
  )
  const githubPullRequestsEnabled =
    normalizeBoolean(value.githubPullRequestsEnabled) ??
    DEFAULT_AGENT_SETTINGS.githubPullRequestsEnabled
  const updateChannel = isValidUpdateChannel(value.updateChannel)
    ? value.updateChannel
    : DEFAULT_AGENT_SETTINGS.updateChannel
  let updatePolicy = isValidUpdatePolicy(value.updatePolicy)
    ? normalizeUpdatePolicyForChannel(value.updatePolicy, updateChannel)
    : DEFAULT_AGENT_SETTINGS.updatePolicy
  updatePolicy = normalizeUpdatePolicyForChannel(updatePolicy, updateChannel)
  const releaseNotesSeenVersion =
    typeof value.releaseNotesSeenVersion === 'string' &&
    value.releaseNotesSeenVersion.trim().length > 0
      ? value.releaseNotesSeenVersion.trim()
      : DEFAULT_AGENT_SETTINGS.releaseNotesSeenVersion
  const hideWorktreeMismatchDropWarning =
    normalizeBoolean(value.hideWorktreeMismatchDropWarning) ??
    DEFAULT_AGENT_SETTINGS.hideWorktreeMismatchDropWarning

  return {
    language,
    uiTheme,
    isPrimarySidebarCollapsed,
    workspaceSearchPanelWidth,
    defaultProvider,
    agentProviderOrder,
    agentFullAccess,
    defaultTerminalProfileId:
      defaultTerminalProfileId.length > 0
        ? defaultTerminalProfileId
        : DEFAULT_AGENT_SETTINGS.defaultTerminalProfileId,
    customModelEnabledByProvider,
    customModelByProvider,
    customModelOptionsByProvider,
    taskTitleProvider,
    taskTitleModel,
    taskTagOptions,
    taskPromptTemplates,
    taskPromptTemplatesByWorkspaceId,
    quickCommands,
    quickPhrases,
    agentEnvByProvider,
    focusNodeOnClick,
    focusNodeTargetZoom,
    focusNodeUseVisibleCanvasCenter,
    standbyBannerEnabled,
    standbyBannerShowTask,
    standbyBannerShowSpace,
    standbyBannerShowBranch,
    standbyBannerShowPullRequest,
    disableAppShortcutsWhenTerminalFocused,
    keybindings,
    canvasInputMode,
    canvasWheelBehavior,
    canvasWheelZoomModifier,
    standardWindowSizeBucket,
    websiteWindowPolicy,
    experimentalWebsiteWindowPasteEnabled,
    experimentalRemoteWorkersEnabled,
    defaultTerminalWindowScalePercent,
    terminalFontSize,
    terminalFontFamily,
    uiFontSize,
    githubPullRequestsEnabled,
    updatePolicy,
    updateChannel,
    releaseNotesSeenVersion,
    hideWorktreeMismatchDropWarning,
  }
}
