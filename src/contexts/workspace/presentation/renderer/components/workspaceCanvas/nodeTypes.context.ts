import { createContext, createElement, useContext, type ReactNode } from 'react'
import type { MutableRefObject } from 'react'
import type { BrowserMode } from '@shared/contracts/dto'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'
import type { WiredCanvasNodeCommands } from './nodeCommands'
import type {
  QuickUpdateTaskRequirement,
  QuickUpdateTaskTitle,
  ShowWorkspaceCanvasMessage,
  UpdateTaskStatus,
} from './types'

/**
 * The action refs of the task family, until PR 7 turns it into commands (S7 of #647). The window,
 * terminal, note, website and role refs are gone: node components read those from `commands`.
 * `nodeTypes.context.spec.ts` pins this set, so a ref cannot return elsewhere.
 */
export interface TransitionalNodeActionRefs {
  openTaskEditorRef: MutableRefObject<(nodeId: string) => void>
  quickUpdateTaskTitleRef: MutableRefObject<QuickUpdateTaskTitle>
  quickUpdateTaskRequirementRef: MutableRefObject<QuickUpdateTaskRequirement>
  runTaskAgentRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resumeTaskAgentSessionRef: MutableRefObject<
    (taskNodeId: string, recordId: string) => Promise<void>
  >
  removeTaskAgentSessionRecordRef: MutableRefObject<(taskNodeId: string, recordId: string) => void>
  updateTaskStatusRef: MutableRefObject<UpdateTaskStatus>
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
const CommandsContext = createContext<WiredCanvasNodeCommands | null>(null)
/**
 * Provides the params, and the commands in a context of their own. A context consumer renders on
 * every change of the value it reads, whatever field it uses, so a memoised window body that reads
 * only commands must not consume the params: they also hold the preferences, which change.
 */
export function WorkspaceCanvasNodeTypesProvider({
  value,
  children,
}: {
  value: WorkspaceCanvasNodeTypesParams
  children?: ReactNode
}) {
  return createElement(
    Context.Provider,
    { value },
    createElement(CommandsContext.Provider, { value: value.commands }, children),
  )
}
export function useWorkspaceCanvasNodeTypeParameters(): WorkspaceCanvasNodeTypesParams {
  const parameters = useContext(Context)
  if (!parameters) {
    throw new Error('Workspace canvas node parameters are missing.')
  }
  return parameters
}

/** The canvas's commands. A node binds its own id where it renders a child. */
export function useCanvasNodeCommands(): WiredCanvasNodeCommands {
  const commands = useContext(CommandsContext)
  if (!commands) {
    throw new Error('Workspace canvas node commands are missing.')
  }
  return commands
}
