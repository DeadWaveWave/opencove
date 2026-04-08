import { useEffect, type MutableRefObject } from 'react'
import { createTerminalCommandInputState } from './commandInput'

export function useTerminalSessionReset({
  commandInputStateRef,
  isTerminalHydratedRef,
  lastSyncedPtySizeRef,
  sessionId,
  setIsTerminalHydrated,
  suppressPtyResizeRef,
}: {
  commandInputStateRef: MutableRefObject<ReturnType<typeof createTerminalCommandInputState>>
  isTerminalHydratedRef: MutableRefObject<boolean>
  lastSyncedPtySizeRef: MutableRefObject<{ cols: number; rows: number } | null>
  sessionId: string
  setIsTerminalHydrated: (value: boolean) => void
  suppressPtyResizeRef: MutableRefObject<boolean>
}): void {
  useEffect(() => {
    lastSyncedPtySizeRef.current = null
    suppressPtyResizeRef.current = false
    commandInputStateRef.current = createTerminalCommandInputState()
    isTerminalHydratedRef.current = false
    setIsTerminalHydrated(false)
  }, [
    commandInputStateRef,
    isTerminalHydratedRef,
    lastSyncedPtySizeRef,
    sessionId,
    setIsTerminalHydrated,
    suppressPtyResizeRef,
  ])
}
