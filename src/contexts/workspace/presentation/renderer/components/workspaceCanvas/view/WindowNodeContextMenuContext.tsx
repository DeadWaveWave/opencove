import {
  createContext,
  useCallback,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { ContextMenuState } from '../types'

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
export function WindowNodeContextMenuProvider({
  setContextMenu,
  closeOtherMenus,
  children,
}: {
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>
  closeOtherMenus: () => void
  children: ReactNode
}) {
  const openMenu = useCallback(
    (request: WindowNodeMenuRequest) => {
      closeOtherMenus()
      setContextMenu({ kind: 'selection', ...request })
    },
    [closeOtherMenus, setContextMenu],
  )
  return <WindowNodeContextMenuContext value={openMenu}>{children}</WindowNodeContextMenuContext>
}
