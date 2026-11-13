import type { Page, TestInfo } from '@playwright/test'

/** Retain the event order; reading it after a failed click must not require reproducing it. */
export async function recordTerminalLinkEvents(window: Page, nodeId: string) {
  const probe = await window.evaluateHandle(id => {
    const events: object[] = []
    const snapshot = () => {
      const api = window.__opencoveTerminalSelectionTestApi
      const point = api?.getCellCenter(id, 12, 1)
      const hit = point ? document.elementFromPoint(point.x, point.y) : null
      return {
        point,
        hit: hit?.className,
        hitNode: hit?.closest('[data-id]')?.getAttribute('data-id'),
        buffer: api?.getBufferText(id, 'UNRELATED_OUTPUT'),
        selection: api?.hasSelection(id),
        focused: document.activeElement?.className,
        visibility: document.visibilityState,
        documentFocused: document.hasFocus(),
      }
    }
    const record = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        event.target.closest('[data-id]')?.getAttribute('data-id') !== id
      ) {
        return
      }
      const intent = event instanceof CustomEvent ? event.detail : undefined
      events.push({
        at: performance.now(),
        type: event.type,
        action: intent?.action,
        text: intent?.text,
        current: intent?.isCurrent?.(),
        pointer:
          event instanceof MouseEvent
            ? { x: event.clientX, y: event.clientY, detail: event.detail }
            : undefined,
        ...snapshot(),
      })
      if (events.length > 80) {
        events.shift()
      }
    }
    const types = [
      'mousedown',
      'mouseup',
      'opencove:terminal-link',
      'opencove:terminal-links-invalidated',
    ]
    types.forEach(type => document.addEventListener(type, record, true))
    return {
      read: () => ({ events, final: snapshot() }),
      stop: () => types.forEach(type => document.removeEventListener(type, record, true)),
    }
  }, nodeId)
  return async (testInfo: TestInfo, failed: boolean) => {
    try {
      if (failed) {
        await testInfo.attach('terminal-link-events', {
          body: JSON.stringify(await probe.evaluate(value => value.read()), null, 2),
          contentType: 'application/json',
        })
      }
    } finally {
      await probe.evaluate(value => value.stop())
      await probe.dispose()
    }
  }
}
