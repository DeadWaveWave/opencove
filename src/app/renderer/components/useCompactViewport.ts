import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

export function useCompactViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth <= 720,
    () => false,
  )
}
