import type {
  AgentProviderId,
  AgentSessionSummary,
  BrowserMode,
  WebsiteWindowSessionMode,
} from '@shared/contracts/dto'
import type { NodeLabelColorOverride } from '@shared/types/labelColor'
import type { NodeFrame, TaskRuntimeStatus } from '../../types'

// What a node component calls to act on the canvas (S7 of #647). Types only. A command takes ids
// and values, never a node object: it reads the window it acts on from the document when it runs,
// for the workspace of the render that made it.

export interface CanvasWindowCommands {
  /** `toggle` adds or removes the window within its Space scope; otherwise selects it alone, unless it is already selected. */
  select(nodeId: string, options?: { toggle?: boolean }): void
  clearSelection(): void
  /** Closes the window if the document holds it. It never confirms: task and role windows call `requestDelete`, which does. */
  close(nodeId: string): Promise<void>
  requestDelete(nodeIds: readonly string[]): void
  resize(nodeId: string, desiredFrame: NodeFrame): void
  /** Centres the window when "focus on click" is on. */
  focusForInteraction(nodeId: string): void
  setLabelColorOverride(nodeIds: readonly string[], override: NodeLabelColorOverride): void
}

export interface CanvasTerminalCommands {
  updateScrollback(nodeId: string, scrollback: string): void
  /** A command the shell ran in a terminal: it titles the window unless the user pinned a title. */
  recordCommandRun(nodeId: string, command: string, startedAtMs?: number): void
  clearAgentOverlay(nodeId: string, expectedStartedAtMs?: number): void
  renameTitle(nodeId: string, title: string): void
  copyLastAgentMessage(nodeId: string): Promise<void>
  reloadAgentSession(nodeId: string): Promise<void>
  listAgentSessions(nodeId: string, limit?: number): Promise<AgentSessionSummary[]>
  switchAgentSession(nodeId: string, summary: AgentSessionSummary): Promise<void>
}

export interface CanvasNoteCommands {
  updateText(nodeId: string, text: string): void
  renameTitle(nodeId: string, title: string): void
  convertToTask(nodeId: string): boolean
}

export interface CanvasWebsiteCommands {
  updateUrl(nodeId: string, url: string): void
  setPinned(nodeId: string, pinned: boolean): void
  setSession(nodeId: string, sessionMode: WebsiteWindowSessionMode, profileId: string | null): void
  setMode(nodeId: string, browserMode: BrowserMode): void
  setFullscreen(
    nodeId: string,
    frame: NodeFrame,
    previousFrame: NodeFrame | null,
    isFullscreen: boolean,
  ): void
}

interface CanvasRoleCommands {
  updateInput(nodeId: string, input: string): void
  updateProvider(nodeId: string, provider: AgentProviderId): void
  run(nodeId: string, inputOverride?: string): Promise<void>
}

interface CanvasTaskCommands {
  runAgent(nodeId: string): Promise<void>
  resumeAgentSession(taskNodeId: string, recordId: string): Promise<void>
  removeAgentSessionRecord(taskNodeId: string, recordId: string): void
  openEditor(nodeId: string): void
  updateTitle(nodeId: string, title: string): void
  updateRequirement(nodeId: string, requirement: string): void
  updateStatus(nodeId: string, status: TaskRuntimeStatus): void
}

/** The whole surface, as the type test reads it (no ref, no command that takes a node object). */
export interface CanvasNodeCommands {
  readonly window: CanvasWindowCommands
  readonly terminal: CanvasTerminalCommands
  readonly note: CanvasNoteCommands
  readonly website: CanvasWebsiteCommands
  readonly role: CanvasRoleCommands
  readonly task: CanvasTaskCommands
}

/**
 * The families that are wired so far: window, note and website (PR 4), and terminal (PR 5). The
 * role and task families join in PRs 6 and 7, each one removing its refs from the node types
 * params; this alias is replaced by `CanvasNodeCommands` in PR 7.
 */
export type WiredCanvasNodeCommands = Pick<
  CanvasNodeCommands,
  'window' | 'terminal' | 'note' | 'website'
>
