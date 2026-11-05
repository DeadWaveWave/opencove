import type {
  AppUpdateChannel,
  AppUpdatePolicy,
  BrowserMode,
  WebsiteWindowPolicy,
} from '../../../shared/contracts/dto'
import type {
  AgentCustomModelByProvider,
  AgentCustomModelEnabledByProvider,
  AgentCustomModelOptionsByProvider,
} from './agentSettings.customModels'
import type { AgentExecutablePathOverrideByProvider } from './agentSettings.executables'
import type { AgentProvider, TaskTitleAgentProvider } from './agentSettings.providers'
import type { BrowserSearchEngineId } from './browserSettings'
import type { SidebarViewSettings } from './sidebarViewSettings'
import type {
  ViewportTransition,
  CanvasInputMode,
  CanvasWheelBehavior,
  CanvasWheelZoomModifier,
  NodeExpandBehavior,
  StandardWindowSizeBucket,
} from './canvasSettings'
import type { AgentEnvByProvider } from './agentEnv'
import type { FocusNodeTargetZoom } from './focusNodeTargetZoom'
import type { KeybindingOverrides } from './keybindings'
import type { ProjectRolesByWorkspaceId } from './projectRoles'
import type { QuickCommand } from './quickCommands'
import type { QuickPhrase } from './quickPhrases'
import type { TaskPromptTemplate, TaskPromptTemplatesByWorkspaceId } from './taskPromptTemplates'
import type { TerminalBackgroundMode } from './terminalBackgroundSettings'
import type { CanvasBackgroundStyle } from './canvasBackgroundSettings'
import type { TerminalDisplayReference } from './terminalDisplayCalibration'
import type { UiLanguage, UiTheme } from './uiSettings'
import type { PluginContributionPreferences } from './pluginSettings'

export type TaskTitleProvider = 'default' | TaskTitleAgentProvider
export type TerminalProfileId = string | null

export interface PixelEffectSettings {
  canvasBackgroundStyle: CanvasBackgroundStyle
  canvasBackgroundTwinkleEnabled: boolean
  nodeCreationPixelEffectEnabled: boolean
  nodeClosePixelEffectEnabled: boolean
  agentWorkingPixelEffectEnabled: boolean
}

/** The effect switches; the background style is a choice of three, not a switch. */
export type PixelEffectToggle = Exclude<keyof PixelEffectSettings, 'canvasBackgroundStyle'>

/** Window material (Tide 2.7). Reduced transparency in the system always means solid. */
export const WINDOW_MATERIALS = ['glass', 'solid'] as const
export type WindowMaterial = (typeof WINDOW_MATERIALS)[number]

/** How windows look: their kind channel and their material. */
export interface WindowAppearanceSettings {
  /** Colours window tiles and header tints by what the window is (Tide kind channel). */
  windowKindColorsEnabled: boolean
  /** Glass, or solid windows, menus and panels with no blur; the system preference forces solid. */
  windowMaterial: WindowMaterial
}

export interface AgentSettings extends PixelEffectSettings, WindowAppearanceSettings {
  language: UiLanguage
  uiTheme: UiTheme
  disabledPluginIds: string[]
  pluginContributions: PluginContributionPreferences
  isPrimarySidebarCollapsed: boolean
  sidebarCollapsedWorkspaceIds: Record<string, boolean>
  sidebarCollapsedSpaceGroupIds: Record<string, boolean>
  sidebarView: SidebarViewSettings
  workspaceSearchPanelWidth: number
  defaultProvider: AgentProvider
  agentProviderOrder: AgentProvider[]
  agentFullAccess: boolean
  defaultTerminalProfileId: TerminalProfileId
  agentExecutablePathOverrideByProvider: AgentExecutablePathOverrideByProvider<AgentProvider>
  customModelEnabledByProvider: AgentCustomModelEnabledByProvider<AgentProvider>
  customModelByProvider: AgentCustomModelByProvider<AgentProvider>
  customModelOptionsByProvider: AgentCustomModelOptionsByProvider<AgentProvider>
  taskTitleProvider: TaskTitleProvider
  taskTitleModel: string
  taskTagOptions: string[]
  taskPromptTemplates: TaskPromptTemplate[]
  taskPromptTemplatesByWorkspaceId: TaskPromptTemplatesByWorkspaceId
  projectRolesByWorkspaceId: ProjectRolesByWorkspaceId
  quickCommands: QuickCommand[]
  quickPhrases: QuickPhrase[]
  agentEnvByProvider: AgentEnvByProvider
  viewportTransition: ViewportTransition
  focusNodeOnClick: boolean
  focusNodeTargetZoom: FocusNodeTargetZoom
  focusNodeUseVisibleCanvasCenter: boolean
  systemNotificationsEnabled: boolean
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
  nodeExpandBehavior: NodeExpandBehavior
  preserveWindowSizesOnArrange: boolean
  websiteWindowPolicy: WebsiteWindowPolicy
  browserDefaultMode: BrowserMode
  browserSearchEngine: BrowserSearchEngineId
  experimentalWebsiteWindowPasteEnabled: boolean
  /** @deprecated Retained for saved profiles; remote connections are always available. */
  experimentalRemoteWorkersEnabled: boolean
  defaultTerminalWindowScalePercent: number
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalBackground: TerminalBackgroundMode
  terminalDisplayAutoReferenceEnabled: boolean
  terminalDisplayCalibrationCompensationEnabled: boolean
  terminalDisplayReference: TerminalDisplayReference | null
  uiFontSize: number
  performanceMonitorHeaderButtonEnabled: boolean
  githubPullRequestsEnabled: boolean
  updatePolicy: AppUpdatePolicy
  updateChannel: AppUpdateChannel
  releaseNotesSeenVersion: string | null
  hideWorktreeMismatchDropWarning: boolean
  archiveSpaceDeleteWorktreeByDefault: boolean
  archiveSpaceDeleteBranchByDefault: boolean
}
