import React from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { WiredCanvasNodeCommands } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
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
  note: { updateText: noop, renameTitle: noop, convertToTask: () => false },
  website: {
    updateUrl: noop,
    setPinned: noop,
    setSession: noop,
    setMode: noop,
    setFullscreen: noop,
  },
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
