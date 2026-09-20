/** Presentation-only timing. No animation writes to workspace or runtime geometry. */
export const COLLAPSE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const WINDOW_FOLD_MS = 280
export const WINDOW_UNFOLD_MS = 360

export function canAnimateCollapse(): boolean {
  return (
    typeof Element.prototype.animate === 'function' &&
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/** One disposable animation group; cancellation never commits computed styles. */
export function createCollapseAnimationGroup(onDispose: () => void = () => {}) {
  const animations: Animation[] = []
  let disposed = false
  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    for (const animation of animations) {
      animation.cancel()
    }
    onDispose()
  }
  return {
    animate(element: Element, frames: Keyframe[], duration: number, delay = 0) {
      const animation = element.animate(frames, {
        duration,
        delay,
        easing: COLLAPSE_EASING,
        fill: 'both',
      })
      animations.push(animation)
      return animation
    },
    finish() {
      // cancel() rejects finished with AbortError. Both finish and interruption
      // release the same group; stale completions cannot clear a newer group.
      void Promise.all(animations.map(animation => animation.finished)).then(dispose, dispose)
    },
    dispose,
  }
}

export function canvasScale(element: Element): number {
  const viewport = element.closest('.react-flow__viewport')
  if (!viewport) {
    return 1
  }
  const transform = getComputedStyle(viewport).transform
  return transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a || 1
}
