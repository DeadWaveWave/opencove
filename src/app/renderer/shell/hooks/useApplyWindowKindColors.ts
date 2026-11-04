import { useEffect } from 'react'

/** Window tiles and header tints read `data-cove-kind-colors` on the root; "off" keeps them neutral. */
export function useApplyWindowKindColors(enabled: boolean): void {
  useEffect(() => {
    document.documentElement.dataset.coveKindColors = enabled ? 'on' : 'off'
  }, [enabled])
}
