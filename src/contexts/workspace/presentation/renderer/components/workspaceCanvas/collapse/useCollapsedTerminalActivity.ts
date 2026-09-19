import { useEffect, type RefObject } from 'react'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'

/** Output is a transient visual signal, never a claim that a command is busy. */
export function useCollapsedTerminalActivity(
  sessionId: string,
  enabled: boolean,
  icon: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const element = icon.current
    if (!element || !enabled || !sessionId) {
      return
    }
    let timer: number | undefined
    const unsubscribe = getPtyEventHub().onSessionData(sessionId, event => {
      if (!event.data || document.visibilityState === 'hidden') {
        return
      }
      element.dataset.outputActive = 'true'
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        delete element.dataset.outputActive
      }, 1_050)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
      delete element.dataset.outputActive
    }
  }, [enabled, icon, sessionId])
}
