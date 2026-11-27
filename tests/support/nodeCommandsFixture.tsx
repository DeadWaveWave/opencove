import React from 'react'
import type { ReactElement, ReactNode } from 'react'
import type {
  CanvasNodeCommands,
  CanvasRoleCommands,
  CanvasTaskCommands,
  CanvasTerminalCommands,
} from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
import {
  WorkspaceCanvasNodeTypesProvider,
  type WorkspaceCanvasNodeTypesParams,
} from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context'

const noop = (): void => {}

/** Commands that do nothing, for a node component under test that does not act. */
export const noopNodeCommands: CanvasNodeCommands = {
  window: {
    select: noop,
    clearSelection: noop,
    close: async () => {},
    requestDelete: noop,
    resize: noop,
    focusForInteraction: noop,
    setLabelColorOverride: noop,
  },
  terminal: {
    updateScrollback: noop,
    recordCommandRun: noop,
    clearAgentOverlay: noop,
    renameTitle: noop,
    copyLastAgentMessage: async () => {},
    reloadAgentSession: async () => {},
    listAgentSessions: async () => [],
    switchAgentSession: async () => {},
  },
  note: { updateText: noop, renameTitle: noop, convertToTask: () => false },
  website: {
    updateUrl: noop,
    setPinned: noop,
    setSession: noop,
    setMode: noop,
    setFullscreen: noop,
  },
  role: { updateInput: noop, updateProvider: noop, run: async () => {} },
  task: {
    runAgent: async () => {},
    resumeAgentSession: async () => {},
    removeAgentSessionRecord: noop,
    openEditor: noop,
    updateTitle: noop,
    updateRequirement: noop,
    updateStatus: noop,
  },
}

/** The commands that do nothing, with the given terminal commands in place of the terminal's. */
export function withTerminalCommands(
  terminal: Partial<CanvasTerminalCommands>,
): CanvasNodeCommands {
  return { ...noopNodeCommands, terminal: { ...noopNodeCommands.terminal, ...terminal } }
}

/** The commands that do nothing, with the given role commands in place of the role's. */
export function withRoleCommands(role: Partial<CanvasRoleCommands>): CanvasNodeCommands {
  return { ...noopNodeCommands, role: { ...noopNodeCommands.role, ...role } }
}

/** The commands that do nothing, with the given task commands in place of the task's. */
export function withTaskCommands(task: Partial<CanvasTaskCommands>): CanvasNodeCommands {
  return { ...noopNodeCommands, task: { ...noopNodeCommands.task, ...task } }
}

/**
 * Provides `commands` to a node type component rendered without a canvas. Only `commands` is
 * read by the component: the rest of the params is the caller's to give, when it needs it.
 */
export function NodeCommandsProvider({
  commands = noopNodeCommands,
  children,
}: {
  commands?: CanvasNodeCommands
  children: ReactNode
}): ReactElement {
  return (
    <WorkspaceCanvasNodeTypesProvider value={{ commands } as WorkspaceCanvasNodeTypesParams}>
      {children}
    </WorkspaceCanvasNodeTypesProvider>
  )
}
