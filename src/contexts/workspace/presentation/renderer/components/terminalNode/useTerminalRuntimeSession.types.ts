import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import type { AgentLaunchMode, AgentRuntimeStatus, WorkspaceNodeKind } from '../../types'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { TerminalCommandInputState } from './commandInput'
import type { PreferredTerminalRendererMode } from './preferredRenderer'
import type { TerminalRendererRecoveryRequest } from './runtimeRendererHealth'
import type { TerminalOutputScheduler } from './outputScheduler'
import type { TerminalRendererKind } from './useWebglPixelSnappingScheduler'
import type { XtermSession } from './xtermSession'
import type { TerminalThemeMode } from './theme'
import type { TerminalPtyGeometry } from '@shared/contracts/dto'

export interface TerminalRuntimeSessionOptions {
  nodeId: string
  sessionId: string
  kind: WorkspaceNodeKind
  terminalProvider: AgentProvider | null
  initialTerminalGeometryRef: { current: TerminalPtyGeometry | null }
  agentLaunchModeRef: { current: AgentLaunchMode | null }
  agentResumeSessionIdVerifiedRef: { current: boolean }
  statusRef: { current: AgentRuntimeStatus | null }
  titleRef: { current: string }
  terminalThemeMode: TerminalThemeMode
  isTestEnvironment: boolean
  containerRef: { current: HTMLDivElement | null }
  terminalRef: { current: Terminal | null }
  fitAddonRef: { current: FitAddon | null }
  outputSchedulerRef: { current: TerminalOutputScheduler | null }
  isViewportInteractionActiveRef: { current: boolean }
  isPointerResizingRef: { current: boolean }
  suppressPtyResizeRef: { current: boolean }
  lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null }
  commandInputStateRef: { current: TerminalCommandInputState }
  onCommandRunRef: { current: ((command: string) => void) | undefined }
  scrollbackBufferRef: {
    current: {
      snapshot: () => string
      set: (snapshot: string) => void
      append: (data: string) => void
    }
  }
  markScrollbackDirty: (immediate?: boolean) => void
  scheduleTranscriptSync: () => void
  cancelScrollbackPublish: () => void
  disposeScrollbackPublish: () => void
  syncTerminalSize: () => void
  applyTerminalTheme: () => void
  bindSearchAddonToFind: (addon: SearchAddon) => () => void
  openTerminalFind: () => void
  isTerminalHydratedRef: { current: boolean }
  setIsTerminalHydrated: (hydrated: boolean) => void
  shouldRestoreTerminalFocusRef: { current: boolean }
  preservedXtermSessionRef: { current: XtermSession | null }
  recentUserInteractionAtRef: { current: number }
  pendingUserInputBufferRef: {
    current: Array<{ data: string; encoding: 'utf8' | 'binary' }>
  }
  isLiveSessionReattach: boolean
  activeRendererKindRef: { current: TerminalRendererKind }
  scheduleWebglPixelSnapping: () => void
  cancelWebglPixelSnapping: () => void
  setRendererKindAndApply: (kind: TerminalRendererKind) => void
  terminalFontSize: number
  viewportZoomRef: { current: number }
  preferredRendererMode: PreferredTerminalRendererMode
  terminalClientResetVersion: number
  requestTerminalRendererRecovery: (request: TerminalRendererRecoveryRequest) => void
}
