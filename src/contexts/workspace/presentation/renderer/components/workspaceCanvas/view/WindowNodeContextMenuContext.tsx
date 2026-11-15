import { createContext, useCallback, type ReactNode } from 'react'
import { useCanvasUiCommands } from '../../../store/canvasStoreContext'

interface WindowNodeMenuRequest {
  nodeId?: string
  x: number
  y: number
  closeWindow: () => void
}

export const WindowNodeContextMenuContext = createContext<
  ((request: WindowNodeMenuRequest) => void) | null
>(null)

/** Compact chrome uses the canvas menu while each mounted runtime retains its close guard. */
export function WindowNodeContextMenuProvider({ children }: { children: ReactNode }) {
  const ui = useCanvasUiCommands()
  const openMenu = useCallback(
    (request: WindowNodeMenuRequest) => {
      ui.openContextMenu({ kind: 'selection', ...request })
    },
    [ui],
  )
  return <WindowNodeContextMenuContext value={openMenu}>{children}</WindowNodeContextMenuContext>
}
