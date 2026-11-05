import { useSyncExternalStore } from 'react'

/**
 * Showcase mode (Tide 6.1): for screen recordings and demos the top bar, sidebar and canvas
 * chrome hide, and the pixel wall's clouds drift faster. It lives for this window's session
 * only: nothing is saved, and a restart starts without it. This module is its one owner; it
 * marks the document (`data-cove-showcase`) for the shell's CSS and leaves on Escape.
 */
let active = false
const listeners = new Set<() => void>()

function onKeyDown(event: KeyboardEvent): void {
  // An open menu, dialog or command center closes first and marks the key as used.
  if (event.key === 'Escape' && !event.defaultPrevented) {
    setShowcaseMode(false)
  }
}

export function isShowcaseMode(): boolean {
  return active
}

export function setShowcaseMode(next: boolean): void {
  if (next === active) {
    return
  }
  active = next
  document.documentElement.toggleAttribute('data-cove-showcase', next)
  if (next) {
    window.addEventListener('keydown', onKeyDown)
  } else {
    window.removeEventListener('keydown', onKeyDown)
  }
  listeners.forEach(listener => listener())
}

export function subscribeShowcaseMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useShowcaseMode(): boolean {
  return useSyncExternalStore(subscribeShowcaseMode, isShowcaseMode, () => false)
}
