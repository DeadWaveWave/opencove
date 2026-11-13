import type { Page } from '@playwright/test'

export async function readResolvedCanvasInputMode(window: Page): Promise<string | null> {
  return await window.locator('.workspace-canvas').getAttribute('data-canvas-input-mode')
}

export async function dispatchCanvasWheel(
  window: Page,
  eventInit: Partial<WheelEventInit>,
): Promise<void> {
  await window.evaluate(event => {
    const paneElement = document.querySelector('.workspace-canvas .react-flow__pane')
    if (!(paneElement instanceof HTMLElement)) {
      return
    }

    paneElement.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        ...event,
      }),
    )
  }, eventInit)
}

// Retain dispatch-time evidence: a later DOM snapshot cannot explain a lost wheel.
export async function recordWheelGestures(window: Page) {
  return await window.evaluateHandle(() => {
    const events: Array<{
      timeStamp: number
      deltaX: number
      deltaY: number
      target: string | null
      captureActive: string | null
    }> = []
    document.addEventListener(
      'wheel',
      event => {
        events.push({
          timeStamp: event.timeStamp,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          target: event.target instanceof Element ? event.target.className : null,
          captureActive:
            document
              .querySelector('.workspace-canvas')
              ?.getAttribute('data-cove-wheel-gesture-capture-active') ?? null,
        })
      },
      { capture: true },
    )
    return events
  })
}
