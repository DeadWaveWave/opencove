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
import type {
  CanvasInputMode,
  CanvasWheelBehavior,
  CanvasWheelZoomModifier,
  StandardWindowSizeBucket,
} from './canvasSettings'
import type { AgentEnvByProvider } from './agentEnv'
import type { FocusNodeTargetZoom } from './focusNodeTargetZoom'
import type { KeybindingOverrides } from './keybindings'
import type { ProjectRolesByWorkspaceId } from './projectRoles'
import type { QuickCommand } from './quickCommands'
import type { QuickPhrase } from './quickPhrases'
import type { TaskPromptTemplate, TaskPromptTemplatesByWorkspaceId } from './taskPromptTemplates'
import type { TerminalDisplayReference } from './terminalDisplayCalibration'
import type { UiLanguage, UiTheme } from './uiSettings'

export type TaskTitleProvider = 'default' | TaskTitleAgentProvider
export type TerminalProfileId = string | null

export interface AgentSettings {
  language: UiLanguage
  uiTheme: UiTheme
  isPrimarySidebarCollapsed: boolean
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
  websiteWindowPolicy: WebsiteWindowPolicy
  browserDefaultMode: BrowserMode
  browserSearchEngine: BrowserSearchEngineId
  experimentalWebsiteWindowPasteEnabled: boolean
  experimentalRemoteWorkersEnabled: boolean
  defaultTerminalWindowScalePercent: number
  terminalFontSize: number
  terminalFontFamily: string | null
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
