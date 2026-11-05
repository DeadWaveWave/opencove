import { createContext, useContext, useEffect } from 'react'

/**
 * The app window's wall layer (Tide): the pixel wall fills the window behind the shell, and the
 * top bar and sidebar float on it as glass. `undefined` outside the app shell, where a wall
 * stays inside its own canvas; `null` while the layer is mounting.
 */
export const ShellWallLayerContext = createContext<HTMLElement | null | undefined>(undefined)

export function useShellWallLayer(): HTMLElement | null | undefined {
  return useContext(ShellWallLayerContext)
}

/** Whether a sheet (the settings page) covers the canvas, and how a sheet says so. */
export const ShellWallCoverContext = createContext<{
  covered: boolean
  setCovered: (covered: boolean) => void
}>({ covered: false, setCovered: () => undefined })

/** The canvas is behind a sheet: the wall frosts all of it, as it does behind the chrome. */
export function useShellWallCovered(): boolean {
  return useContext(ShellWallCoverContext).covered
}

/** Called by a sheet that covers the canvas while `covering` is true. */
export function useCoverShellWall(covering: boolean): void {
  const { setCovered } = useContext(ShellWallCoverContext)
  useEffect(() => {
    if (!covering) {
      return undefined
    }
    setCovered(true)
    return () => setCovered(false)
  }, [covering, setCovered])
}
