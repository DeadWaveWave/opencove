import {
  readThemeTransition,
  subscribeThemeMotion,
} from '@contexts/plugins/presentation/renderer/themeMotion'

/** Presentation-only timing. No animation writes to workspace or runtime geometry. */
export const COLLAPSE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const WINDOW_FOLD_MS = 280
export const WINDOW_UNFOLD_MS = 360

export function canAnimateCollapse(kind?: 'fold' | 'unfold'): boolean {
  return (
    (!kind || readThemeTransition(kind).durationMs > 0) &&
    typeof Element.prototype.animate === 'function' &&
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/** One disposable animation group; cancellation never commits computed styles. */
export function createCollapseAnimationGroup(
  onDispose: () => void = () => {},
  easing = COLLAPSE_EASING,
) {
  const animations: Animation[] = []
  let disposed = false
  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    unsubscribe()
    for (const animation of animations) {
      animation.cancel()
    }
    onDispose()
  }
  const unsubscribe = subscribeThemeMotion(dispose)
  return {
    animate(element: Element, frames: Keyframe[], duration: number, delay = 0) {
      if (disposed) {
        return null
      }
      try {
        const animation = element.animate(frames, { duration, delay, easing, fill: 'both' })
        // Attach rejection handling before another element can fail or a switch cancels.
        void animation.finished.catch(() => {})
        animations.push(animation)
        return animation
      } catch {
        dispose()
        return null
      }
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
