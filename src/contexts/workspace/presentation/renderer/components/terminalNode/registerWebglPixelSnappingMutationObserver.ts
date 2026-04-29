export function registerWebglPixelSnappingMutationObserver(_input: {
  container: HTMLElement | null
  isWebglRenderer: () => boolean
  scheduleWebglPixelSnapping: () => void
}): () => void {
  // Disabled: MutationObserver + double-rAF causes drag lag when DevTools is open.
  // webglPixelSnapping has no measurable effect on clarity (A/B tested).
  // Viewport DPR snapping is handled by useViewportDprSnapping instead.
  return () => undefined
}
