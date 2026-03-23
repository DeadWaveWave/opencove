import { TERMINAL_LAYOUT_SYNC_EVENT } from './constants'

export function registerTerminalLayoutSync(onLayoutSync: () => void): () => void {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      onLayoutSync()
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('focus', onLayoutSync)
  window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, onLayoutSync)

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('focus', onLayoutSync)
    window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, onLayoutSync)
  }
}
