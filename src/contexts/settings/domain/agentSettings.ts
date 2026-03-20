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

const MIN_LEGACY_UI_FONT_SCALE_PERCENT = 85
const MAX_LEGACY_UI_FONT_SCALE_PERCENT = 140

export const AGENT_PROVIDER_LABEL: Record<AgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
}

export interface AgentProviderCapabilities {
  taskTitle: boolean
  worktreeNameSuggestion: boolean
  runtimeObservation: 'jsonl' | 'provider-api' | 'none'
  experimental: boolean
}

export const AGENT_PROVIDER_CAPABILITIES: Record<AgentProvider, AgentProviderCapabilities> = {
  'claude-code': {
    taskTitle: true,
    worktreeNameSuggestion: true,
    runtimeObservation: 'jsonl',
    experimental: false,
  },
  codex: {
    taskTitle: true,
    worktreeNameSuggestion: true,
    runtimeObservation: 'jsonl',
    experimental: false,
  },
  opencode: {
    taskTitle: false,
    worktreeNameSuggestion: false,
    runtimeObservation: 'provider-api',
    experimental: false,
  },
  gemini: {
    taskTitle: false,
    worktreeNameSuggestion: false,
    runtimeObservation: 'none',
    experimental: false,
  },
}

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

export interface AgentSettings {
  language: UiLanguage
  uiTheme: UiTheme
  isPrimarySidebarCollapsed: boolean
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
  normalizeZoomOnTerminalClick: boolean
  canvasInputMode: CanvasInputMode
  defaultTerminalWindowScalePercent: number
  terminalFontSize: number
  uiFontSize: number
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  language: DEFAULT_UI_LANGUAGE,
  uiTheme: 'system',
  isPrimarySidebarCollapsed: false,
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
  normalizeZoomOnTerminalClick: true,
  canvasInputMode: 'auto',
  defaultTerminalWindowScalePercent: 80,
  terminalFontSize: 13,
  uiFontSize: 18,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
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

function isValidUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && UI_LANGUAGES.includes(value as UiLanguage)
}

function isValidUiTheme(value: unknown): value is UiTheme {
  return typeof value === 'string' && UI_THEMES.includes(value as UiTheme)
}

function normalizeTextValue(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

function normalizeModelEnabled(value: unknown): boolean | null {
  if (typeof value !== 'boolean') {
    return null
  }

  return value
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value !== 'boolean') {
    return null
  }

  return value
}

function normalizeIntegerInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const normalized = Math.round(value)
  return Math.max(min, Math.min(max, normalized))
}

function normalizeModelOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: string[] = []
  for (const item of value) {
    const model = normalizeTextValue(item)
    if (model.length === 0 || normalized.includes(model)) {
      continue
    }

    normalized.push(model)
  }

  return normalized
}

function normalizeTagOptions(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback]
  }

  const normalized: string[] = []
  for (const item of value) {
    const tag = normalizeTextValue(item)
    if (tag.length === 0 || normalized.includes(tag)) {
      continue
    }

    normalized.push(tag)
  }

  return normalized.length > 0 ? normalized : [...fallback]
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
      const normalizedEnabled = normalizeModelEnabled(enabledInput[provider])
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
      const options = normalizeModelOptions(optionsInput[provider])
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
  const taskTagOptions = normalizeTagOptions(
    value.taskTagOptions,
    DEFAULT_AGENT_SETTINGS.taskTagOptions,
  )
  const normalizeZoomOnTerminalClick =
    normalizeBoolean(value.normalizeZoomOnTerminalClick) ??
    DEFAULT_AGENT_SETTINGS.normalizeZoomOnTerminalClick
  const canvasInputMode = isValidCanvasInputMode(value.canvasInputMode)
    ? value.canvasInputMode
    : DEFAULT_AGENT_SETTINGS.canvasInputMode
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

  return {
    language,
    uiTheme,
    isPrimarySidebarCollapsed,
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
    normalizeZoomOnTerminalClick,
    canvasInputMode,
    defaultTerminalWindowScalePercent,
    terminalFontSize,
    uiFontSize,
  }
}
