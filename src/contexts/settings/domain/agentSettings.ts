import type { AppUpdateChannel, AppUpdatePolicy } from '../../../shared/contracts/dto'
import { normalizeFocusNodeTargetZoom, type FocusNodeTargetZoom } from './focusNodeTargetZoom'
import {
  isValidUpdateChannel,
  isValidUpdatePolicy,
  normalizeUpdatePolicyForChannel,
} from './updateSettings'
import type { KeybindingOverrides } from './keybindings'
import { normalizeKeybindingOverrides } from './keybindings'
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

export {
  FOCUS_NODE_TARGET_ZOOM_STEP,
  MAX_FOCUS_NODE_TARGET_ZOOM,
  MIN_FOCUS_NODE_TARGET_ZOOM,
} from './focusNodeTargetZoom'
export type { FocusNodeTargetZoom } from './focusNodeTargetZoom'

export const AGENT_PROVIDERS = ['claude-code', 'codex', 'opencode', 'gemini'] as const
export const TASK_TITLE_PROVIDERS = ['claude-code', 'codex'] as const
export const WORKTREE_NAME_SUGGESTION_PROVIDERS = ['claude-code', 'codex'] as const
export const EXPERIMENTAL_AGENT_PROVIDERS = [] as const
export type AgentProvider = (typeof AGENT_PROVIDERS)[number]
export type TaskTitleAgentProvider = (typeof TASK_TITLE_PROVIDERS)[number]
export type WorktreeNameSuggestionAgentProvider =
  (typeof WORKTREE_NAME_SUGGESTION_PROVIDERS)[number]

export type TaskTitleProvider = 'default' | TaskTitleAgentProvider

export const CANVAS_INPUT_MODES = ['auto', 'mouse', 'trackpad'] as const
export type CanvasInputMode = (typeof CANVAS_INPUT_MODES)[number]
export const STANDARD_WINDOW_SIZE_BUCKETS = ['compact', 'regular', 'large'] as const
export type StandardWindowSizeBucket = (typeof STANDARD_WINDOW_SIZE_BUCKETS)[number]

export const UI_LANGUAGES = ['en', 'zh-CN'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]

export const UI_THEMES = ['system', 'light', 'dark'] as const
export type UiTheme = (typeof UI_THEMES)[number]

export type TerminalProfileId = string | null
export const MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT = 60
export const MAX_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT = 120
export const MIN_TERMINAL_FONT_SIZE = 10
export const MAX_TERMINAL_FONT_SIZE = 22
export const MIN_UI_FONT_SIZE = 14
export const MAX_UI_FONT_SIZE = 24
export const DEFAULT_UI_LANGUAGE: UiLanguage = 'en'
export const MIN_WORKSPACE_SEARCH_PANEL_WIDTH = 320
export const MAX_WORKSPACE_SEARCH_PANEL_WIDTH = 720

const MIN_LEGACY_UI_FONT_SCALE_PERCENT = 85
const MAX_LEGACY_UI_FONT_SCALE_PERCENT = 140

export {
  AGENT_PROVIDER_CAPABILITIES,
  AGENT_PROVIDER_LABEL,
  type AgentProviderCapabilities,
} from './agentSettings.providerMeta'

const DEFAULT_TASK_TITLE_PROVIDER: TaskTitleAgentProvider = 'codex'

export const UI_LANGUAGE_NATIVE_LABEL: Record<UiLanguage, string> = {
  en: 'English',
  'zh-CN': '简体中文',
}
export type AgentCustomModelEnabledByProvider = {
  [provider in AgentProvider]: boolean
}

export type AgentCustomModelByProvider = {
  [provider in AgentProvider]: string
}

export type AgentCustomModelOptionsByProvider = {
  [provider in AgentProvider]: string[]
}

export type { TaskPromptTemplate, TaskPromptTemplatesByWorkspaceId } from './taskPromptTemplates'

export interface AgentSettings {
  language: UiLanguage
  uiTheme: UiTheme
  isPrimarySidebarCollapsed: boolean
  workspaceSearchPanelWidth: number
  defaultProvider: AgentProvider
  agentProviderOrder: AgentProvider[]
  agentFullAccess: boolean
  defaultTerminalProfileId: TerminalProfileId
  customModelEnabledByProvider: AgentCustomModelEnabledByProvider
  customModelByProvider: AgentCustomModelByProvider
  customModelOptionsByProvider: AgentCustomModelOptionsByProvider
  taskTitleProvider: TaskTitleProvider
  taskTitleModel: string
  taskTagOptions: string[]
  taskPromptTemplates: TaskPromptTemplate[]
  taskPromptTemplatesByWorkspaceId: TaskPromptTemplatesByWorkspaceId
  focusNodeOnClick: boolean
  focusNodeTargetZoom: FocusNodeTargetZoom
  disableAppShortcutsWhenTerminalFocused: boolean
  keybindings: KeybindingOverrides
  canvasInputMode: CanvasInputMode
  standardWindowSizeBucket: StandardWindowSizeBucket
  defaultTerminalWindowScalePercent: number
  terminalFontSize: number
  uiFontSize: number
  githubPullRequestsEnabled: boolean
  updatePolicy: AppUpdatePolicy
  updateChannel: AppUpdateChannel
  releaseNotesSeenVersion: string | null
  hideWorktreeMismatchDropWarning: boolean
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  language: DEFAULT_UI_LANGUAGE,
  uiTheme: 'dark',
  isPrimarySidebarCollapsed: false,
  workspaceSearchPanelWidth: 420,
  defaultProvider: 'codex',
  agentProviderOrder: [...AGENT_PROVIDERS],
  agentFullAccess: true,
  defaultTerminalProfileId: null,
  customModelEnabledByProvider: {
    'claude-code': false,
    codex: false,
    opencode: false,
    gemini: false,
  },
  customModelByProvider: {
    'claude-code': '',
    codex: '',
    opencode: '',
    gemini: '',
  },
  customModelOptionsByProvider: {
    'claude-code': [],
    codex: [],
    opencode: [],
    gemini: [],
  },
  taskTitleProvider: 'default',
  taskTitleModel: '',
  taskTagOptions: ['feature', 'bug', 'refactor', 'docs', 'test'],
  taskPromptTemplates: [],
  taskPromptTemplatesByWorkspaceId: {},
  focusNodeOnClick: true,
  focusNodeTargetZoom: 1,
  disableAppShortcutsWhenTerminalFocused: true,
  keybindings: {},
  canvasInputMode: 'auto',
  standardWindowSizeBucket: 'regular',
  defaultTerminalWindowScalePercent: 80,
  terminalFontSize: 13,
  uiFontSize: 18,
  githubPullRequestsEnabled: true,
  updatePolicy: 'prompt',
  updateChannel: 'stable',
  releaseNotesSeenVersion: null,
  hideWorktreeMismatchDropWarning: false,
}

function isValidProvider(value: unknown): value is AgentProvider {
  return typeof value === 'string' && AGENT_PROVIDERS.includes(value as AgentProvider)
}

export function isTaskTitleAgentProvider(value: unknown): value is TaskTitleAgentProvider {
  return typeof value === 'string' && TASK_TITLE_PROVIDERS.includes(value as TaskTitleAgentProvider)
}

export function isWorktreeNameSuggestionProvider(
  value: unknown,
): value is WorktreeNameSuggestionAgentProvider {
  return (
    typeof value === 'string' &&
    WORKTREE_NAME_SUGGESTION_PROVIDERS.includes(value as WorktreeNameSuggestionAgentProvider)
  )
}

function isValidTaskTitleProvider(value: unknown): value is TaskTitleProvider {
  return value === 'default' || isTaskTitleAgentProvider(value)
}

function isValidCanvasInputMode(value: unknown): value is CanvasInputMode {
  return typeof value === 'string' && CANVAS_INPUT_MODES.includes(value as CanvasInputMode)
}

function isValidStandardWindowSizeBucket(value: unknown): value is StandardWindowSizeBucket {
  return (
    typeof value === 'string' &&
    STANDARD_WINDOW_SIZE_BUCKETS.includes(value as StandardWindowSizeBucket)
  )
}

function isValidUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && UI_LANGUAGES.includes(value as UiLanguage)
}

function isValidUiTheme(value: unknown): value is UiTheme {
  return typeof value === 'string' && UI_THEMES.includes(value as UiTheme)
}

function normalizeAgentProviderOrder(value: unknown): AgentProvider[] {
  if (!Array.isArray(value)) {
    return [...AGENT_PROVIDERS]
  }

  const normalized: AgentProvider[] = []
  const seen = new Set<AgentProvider>()

  for (const item of value) {
    if (!isValidProvider(item)) {
      continue
    }

    if (seen.has(item)) {
      continue
    }

    seen.add(item)
    normalized.push(item)
  }

  for (const provider of AGENT_PROVIDERS) {
    if (seen.has(provider)) {
      continue
    }

    seen.add(provider)
    normalized.push(provider)
  }

  return normalized
}

export function resolveAgentModel(settings: AgentSettings, provider: AgentProvider): string | null {
  if (!settings.customModelEnabledByProvider[provider]) {
    return null
  }

  const model = settings.customModelByProvider[provider].trim()
  return model.length > 0 ? model : null
}

export function resolveTaskTitleProvider(settings: AgentSettings): TaskTitleAgentProvider {
  if (settings.taskTitleProvider !== 'default') {
    return settings.taskTitleProvider
  }

  return isTaskTitleAgentProvider(settings.defaultProvider)
    ? settings.defaultProvider
    : DEFAULT_TASK_TITLE_PROVIDER
}

export function resolveWorktreeNameSuggestionProvider(
  defaultProvider: AgentProvider,
): WorktreeNameSuggestionAgentProvider {
  return isWorktreeNameSuggestionProvider(defaultProvider)
    ? defaultProvider
    : DEFAULT_TASK_TITLE_PROVIDER
}

export function resolveTaskTitleModel(settings: AgentSettings): string | null {
  const normalized = settings.taskTitleModel.trim()
  return normalized.length > 0 ? normalized : null
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

  const customModelEnabledByProvider = AGENT_PROVIDERS.reduce<AgentCustomModelEnabledByProvider>(
    (acc, provider) => {
      const normalizedEnabled = normalizeBoolean(enabledInput[provider])
      const legacyModel = normalizeTextValue(legacyModelInput[provider])

      acc[provider] = normalizedEnabled === null ? legacyModel.length > 0 : normalizedEnabled

      return acc
    },
    { ...DEFAULT_AGENT_SETTINGS.customModelEnabledByProvider },
  )

  const customModelByProvider = AGENT_PROVIDERS.reduce<AgentCustomModelByProvider>(
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

  const customModelOptionsByProvider = AGENT_PROVIDERS.reduce<AgentCustomModelOptionsByProvider>(
    (acc, provider) => {
      const options = normalizeUniqueStringArray(optionsInput[provider])
      const selectedModel = customModelByProvider[provider]

      if (selectedModel.length > 0 && !options.includes(selectedModel)) {
        options.unshift(selectedModel)
      }

      acc[provider] = options
      return acc
    },
    AGENT_PROVIDERS.reduce<AgentCustomModelOptionsByProvider>(
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
  const focusNodeOnClick =
    normalizeBoolean(value.focusNodeOnClick) ??
    normalizeBoolean(value.normalizeZoomOnTerminalClick) ??
    DEFAULT_AGENT_SETTINGS.focusNodeOnClick
  const focusNodeTargetZoom = normalizeFocusNodeTargetZoom(
    value.focusNodeTargetZoom,
    DEFAULT_AGENT_SETTINGS.focusNodeTargetZoom,
  )
  const disableAppShortcutsWhenTerminalFocused =
    normalizeBoolean(value.disableAppShortcutsWhenTerminalFocused) ??
    DEFAULT_AGENT_SETTINGS.disableAppShortcutsWhenTerminalFocused
  const keybindings = normalizeKeybindingOverrides(value.keybindings)
  const canvasInputMode = isValidCanvasInputMode(value.canvasInputMode)
    ? value.canvasInputMode
    : DEFAULT_AGENT_SETTINGS.canvasInputMode
  const standardWindowSizeBucket = isValidStandardWindowSizeBucket(value.standardWindowSizeBucket)
    ? value.standardWindowSizeBucket
    : DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket
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
    focusNodeOnClick,
    focusNodeTargetZoom,
    disableAppShortcutsWhenTerminalFocused,
    keybindings,
    canvasInputMode,
    standardWindowSizeBucket,
    defaultTerminalWindowScalePercent,
    terminalFontSize,
    uiFontSize,
    githubPullRequestsEnabled,
    updatePolicy,
    updateChannel,
    releaseNotesSeenVersion,
    hideWorktreeMismatchDropWarning,
  }
}
