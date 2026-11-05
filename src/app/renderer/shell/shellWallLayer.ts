import { createContext, useContext } from 'react'

/**
 * The app window's wall layer (Tide): the pixel wall fills the window behind the shell, and the
 * top bar and sidebar float on it as glass. `undefined` outside the app shell, where a wall
 * stays inside its own canvas; `null` while the layer is mounting.
 */
export const ShellWallLayerContext = createContext<HTMLElement | null | undefined>(undefined)

export function useShellWallLayer(): HTMLElement | null | undefined {
  return useContext(ShellWallLayerContext)
}
