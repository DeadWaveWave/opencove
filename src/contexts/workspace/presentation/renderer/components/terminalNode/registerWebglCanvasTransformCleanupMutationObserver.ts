export function registerWebglCanvasTransformCleanupMutationObserver(_input: {
  container: HTMLElement | null
  isWebglRenderer: () => boolean
  scheduleWebglCanvasTransformCleanup: () => void
}): () => void {
  // Disabled: MutationObserver + double-rAF causes drag lag when DevTools is open.
  // Transform cleanup is driven by explicit terminal layout sync points instead.
  return () => undefined
}
