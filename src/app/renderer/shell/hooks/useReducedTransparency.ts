import { useSyncExternalStore } from 'react'

const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)'

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia?.(REDUCED_TRANSPARENCY_QUERY)
  media?.addEventListener('change', onChange)
  return () => media?.removeEventListener('change', onChange)
}

function readSystemPreference(): boolean {
  return window.matchMedia?.(REDUCED_TRANSPARENCY_QUERY).matches ?? false
}

/** Whether the operating system asks apps to reduce transparency; updates live. */
export function useSystemReducedTransparency(): boolean {
  return useSyncExternalStore(subscribe, readSystemPreference, () => false)
}
