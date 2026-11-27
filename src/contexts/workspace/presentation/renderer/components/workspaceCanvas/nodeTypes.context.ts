import { createContext, createElement, useContext, type ReactNode } from 'react'
import type { BrowserMode } from '@shared/contracts/dto'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'
import type { CanvasNodeCommands } from './nodeCommands'
import type { ShowWorkspaceCanvasMessage } from './types'

/**
 * What every node component of a canvas reads from context: six presentation preferences and the
 * commands. The value keeps its identity until a preference or the commands change, so a node
 * renders for its own React Flow props and for nothing else (S7 of #647, Decision 3).
 */
export interface WorkspaceCanvasNodeTypesParams {
  readonly workspacePath: string
  readonly onShowMessage?: ShowWorkspaceCanvasMessage
  readonly agentProviderOrder: AgentProvider[]
  readonly defaultProvider: AgentProvider
  readonly browserDefaultMode: BrowserMode
  readonly browserSearchEngine: BrowserSearchEngineId
  readonly commands: CanvasNodeCommands
}

const Context = createContext<WorkspaceCanvasNodeTypesParams | null>(null)
const CommandsContext = createContext<CanvasNodeCommands | null>(null)
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
export function useCanvasNodeCommands(): CanvasNodeCommands {
  const commands = useContext(CommandsContext)
  if (!commands) {
    throw new Error('Workspace canvas node commands are missing.')
  }
  return commands
}
