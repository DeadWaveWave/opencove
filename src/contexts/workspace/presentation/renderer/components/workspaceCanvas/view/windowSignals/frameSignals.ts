import type { Rgb } from '@shared/design/oklch'

/** What a window frame is showing; a stronger signal replaces a weaker one, never the reverse. */
export type FrameSignal = 'complete' | 'fail'
const RANK: Record<FrameSignal, number> = { complete: 1, fail: 2 }

const active = new Map<HTMLElement, { signal: FrameSignal; timer: ReturnType<typeof setTimeout> }>()

function clear(element: HTMLElement): void {
  const entry = active.get(element)
  if (entry) {
    clearTimeout(entry.timer)
    active.delete(element)
  }
  delete element.dataset.coveSignal
  element.style.removeProperty('--cove-signal-color')
}

/**
 * Lights a window's frame for a moment: a finished run's flash or a failure's glitch.
 * It writes one attribute and one colour variable on the
 * window, only while the signal lasts, and never touches the fill behind its text (Tide).
 */
export function showWindowSignal(
  scope: ParentNode,
  nodeId: string,
  signal: FrameSignal,
  color: Rgb,
  durationMs: number,
): void {
  const element = scope.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`,
  )
  if (!element) {
    return
  }
  const current = active.get(element)
  if (current && RANK[current.signal] > RANK[signal]) {
    return
  }
  clear(element)
  element.dataset.coveSignal = signal
  element.style.setProperty('--cove-signal-color', `rgb(${color[0]} ${color[1]} ${color[2]})`)
  active.set(element, { signal, timer: setTimeout(() => clear(element), durationMs) })
}

export function clearWindowSignals(scope: ParentNode): void {
  for (const element of [...active.keys()]) {
    if (scope.contains(element)) {
      clear(element)
    }
  }
}
