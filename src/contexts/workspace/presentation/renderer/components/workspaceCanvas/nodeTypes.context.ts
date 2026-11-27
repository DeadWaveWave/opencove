import { createContext, useContext } from 'react'
import type { MutableRefObject } from 'react'
import type { AgentSessionSummary, BrowserMode } from '@shared/contracts/dto'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'
import type { WiredCanvasNodeCommands } from './nodeCommands'
import type {
  QuickUpdateTaskRequirement,
  QuickUpdateTaskTitle,
  ShowWorkspaceCanvasMessage,
  UpdateNodeScrollback,
  UpdateTaskStatus,
} from './types'

/**
 * The action refs of the terminal, role and task families, until PRs 5 to 7 turn each family into
 * commands (S7 of #647). The window, note and website refs are gone: node components read those
 * from `commands`. `nodeTypes.context.spec.ts` pins this set, so a ref cannot return elsewhere.
 */
export interface TransitionalNodeActionRefs {
  copyAgentLastMessageRef: MutableRefObject<(nodeId: string) => Promise<void>>
  reloadAgentSessionRef: MutableRefObject<(nodeId: string) => Promise<void>>
  listAgentSessionsRef: MutableRefObject<
    (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>
  >
  switchAgentSessionRef: MutableRefObject<
    (nodeId: string, summary: AgentSessionSummary) => Promise<void>
  >
  updateRoleProviderRef: MutableRefObject<(nodeId: string, provider: AgentProvider) => void>
  updateRoleInputRef: MutableRefObject<(nodeId: string, input: string) => void>
  runRoleRef: MutableRefObject<(nodeId: string, inputOverride?: string) => Promise<void>>
  updateNodeScrollbackRef: MutableRefObject<UpdateNodeScrollback>
  openTaskEditorRef: MutableRefObject<(nodeId: string) => void>
  quickUpdateTaskTitleRef: MutableRefObject<QuickUpdateTaskTitle>
  quickUpdateTaskRequirementRef: MutableRefObject<QuickUpdateTaskRequirement>
  runTaskAgentRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resumeTaskAgentSessionRef: MutableRefObject<
    (taskNodeId: string, recordId: string) => Promise<void>
  >
  removeTaskAgentSessionRecordRef: MutableRefObject<(taskNodeId: string, recordId: string) => void>
  updateTaskStatusRef: MutableRefObject<UpdateTaskStatus>
  updateTerminalTitleRef: MutableRefObject<
    (nodeId: string, title: string, startedAtMs?: number) => void
  >
  clearTerminalAgentOverlayRef: MutableRefObject<
    (nodeId: string, expectedStartedAtMs?: number) => void
  >
  renameTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
}

/**
 * What every node component of a canvas reads from context: six presentation preferences and the
 * commands. The value keeps its identity until a preference or the commands change, so a node
 * renders for its own React Flow props and for nothing else (S7 of #647, Decision 3).
 */
export interface WorkspaceCanvasNodeTypesParams extends TransitionalNodeActionRefs {
  readonly workspacePath: string
  readonly onShowMessage?: ShowWorkspaceCanvasMessage
  readonly agentProviderOrder: AgentProvider[]
  readonly defaultProvider: AgentProvider
  readonly browserDefaultMode: BrowserMode
  readonly browserSearchEngine: BrowserSearchEngineId
  readonly commands: WiredCanvasNodeCommands
}

const Context = createContext<WorkspaceCanvasNodeTypesParams | null>(null)
export const WorkspaceCanvasNodeTypesProvider = Context.Provider
export function useWorkspaceCanvasNodeTypeParameters(): WorkspaceCanvasNodeTypesParams {
  const parameters = useContext(Context)
  if (!parameters) {
    throw new Error('Workspace canvas node parameters are missing.')
  }
  return parameters
}

/** The canvas's commands. A node binds its own id where it renders a child. */
export function useCanvasNodeCommands(): WiredCanvasNodeCommands {
  return useWorkspaceCanvasNodeTypeParameters().commands
}
