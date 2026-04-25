import { TERMINAL_LAYOUT_SYNC_EVENT } from './constants'

export type TerminalLayoutSyncTrigger = 'visibility_resume' | 'window_focus' | 'manual'

export function registerTerminalLayoutSync(
  onLayoutSync: (trigger: TerminalLayoutSyncTrigger) => void,
): () => void {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      onLayoutSync('visibility_resume')
    }
  }
  const handleWindowFocus = () => {
    onLayoutSync('window_focus')
  }
  const handleManualLayoutSync = () => {
    onLayoutSync('manual')
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('focus', handleWindowFocus)
  window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, handleManualLayoutSync)

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('focus', handleWindowFocus)
    window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, handleManualLayoutSync)
  }
}
