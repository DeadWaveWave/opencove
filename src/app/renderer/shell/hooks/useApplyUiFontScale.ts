import { useEffect } from 'react'

export function useApplyUiFontScale(uiFontSize: number): void {
  useEffect(() => {
    const root = document.documentElement
    const uiFontScale = (uiFontSize / 16).toFixed(2)
    root.style.setProperty('--cove-ui-font-scale', uiFontScale)
  }, [uiFontSize])
}
