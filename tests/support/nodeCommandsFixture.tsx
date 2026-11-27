import React from 'react'
import type { ReactElement, ReactNode } from 'react'
import type {
  CanvasTerminalCommands,
  WiredCanvasNodeCommands,
} from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
import {
  WorkspaceCanvasNodeTypesProvider,
  type WorkspaceCanvasNodeTypesParams,
} from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context'

const noop = (): void => {}

/** Commands that do nothing, for a node component under test that does not act. */
export const noopNodeCommands: WiredCanvasNodeCommands = {
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
}

/** The commands that do nothing, with the given terminal commands in place of the terminal's. */
export function withTerminalCommands(
  terminal: Partial<CanvasTerminalCommands>,
): WiredCanvasNodeCommands {
  return { ...noopNodeCommands, terminal: { ...noopNodeCommands.terminal, ...terminal } }
}

/**
 * Provides `commands` to a node type component rendered without a canvas. Only `commands` is
 * read by the component: the rest of the params is the caller's to give, when it needs it.
 */
export function NodeCommandsProvider({
  commands = noopNodeCommands,
  children,
}: {
  commands?: WiredCanvasNodeCommands
  children: ReactNode
}): ReactElement {
  return (
    <WorkspaceCanvasNodeTypesProvider value={{ commands } as WorkspaceCanvasNodeTypesParams}>
      {children}
    </WorkspaceCanvasNodeTypesProvider>
  )
}
