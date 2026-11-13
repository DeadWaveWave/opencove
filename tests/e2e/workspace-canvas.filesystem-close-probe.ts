import type { Page } from '@playwright/test'

/** Retain the hit and node identities even if the close target disappears before inspection. */
export async function installFilesystemCloseProbe(page: Page) {
  const probe = await page.evaluateHandle(() => {
    const records: unknown[] = []
    const identities = new WeakMap<Element, number>()
    let identity = 0
    const describe = (element: Element | null) => {
      if (!element) {
        return null
      }
      if (!identities.has(element)) {
        identities.set(element, ++identity)
      }
      return {
        identity: identities.get(element),
        tag: element.tagName,
        className: element.getAttribute('class'),
        nodeId: element.closest('.react-flow__node')?.getAttribute('data-id'),
        rect: element.getBoundingClientRect().toJSON(),
        scrollLeft: element.scrollLeft,
      }
    }
    const snapshot = () =>
      [...document.querySelectorAll('.document-node')].map(element => ({
        node: describe(element),
        close: describe(element.querySelector('.document-node__close')),
      }))
    const record = (event: Event) => {
      if (event.type === 'scroll') {
        if (event.target instanceof Element && event.target.matches('.react-flow')) {
          records.push({
            at: performance.now(),
            event: event.type,
            target: describe(event.target),
            nodes: snapshot(),
          })
        }
        return
      }
      if (!(event instanceof MouseEvent)) {
        return
      }
      records.push({
        at: performance.now(),
        event: event.type,
        target: describe(event.target instanceof Element ? event.target : null),
        hit: describe(document.elementFromPoint(event.clientX, event.clientY)),
        point: { x: event.clientX, y: event.clientY },
        nodes: snapshot(),
      })
    }
    const events = ['pointerdown', 'pointerup', 'click', 'dragstart', 'drop', 'dragend', 'scroll']
    events.forEach(type => window.addEventListener(type, record, true))
    let previous = ''
    const observer = new MutationObserver(() => {
      const nodes = snapshot()
      const current = JSON.stringify(nodes.map(node => [node.node?.identity, node.close?.identity]))
      if (previous === current) {
        return
      }
      previous = current
      records.push({ at: performance.now(), event: 'nodes', nodes })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return {
      read: () => records,
      measureClose: () => {
        const close = document.querySelector('.document-node__close')
        const rect = close?.getBoundingClientRect()
        const x = rect ? rect.x + rect.width / 2 : 0
        const y = rect ? rect.y + rect.height / 2 : 0
        const hit = document.elementFromPoint(x, y)
        const canvas = document.querySelector('.workspace-canvas')?.getBoundingClientRect()
        const measurement = {
          at: performance.now(),
          event: 'close-target',
          close: describe(close),
          hit: describe(hit),
          receivesEvents: Boolean(close && hit && close.contains(hit)),
          withinCanvas: Boolean(
            rect &&
            canvas &&
            rect.left >= Math.max(0, canvas.left) &&
            rect.top >= Math.max(0, canvas.top) &&
            rect.right <= Math.min(innerWidth, canvas.right) &&
            rect.bottom <= Math.min(innerHeight, canvas.bottom),
          ),
          viewport: { width: innerWidth, height: innerHeight },
        }
        records.push(measurement)
        return measurement
      },
      dispose: () => {
        observer.disconnect()
        events.forEach(type => window.removeEventListener(type, record, true))
      },
    }
  })
  return {
    read: () => probe.evaluate(value => value.read()),
    measureClose: () => probe.evaluate(value => value.measureClose()),
    dispose: async () => {
      await probe.evaluate(value => value.dispose())
      await probe.dispose()
    },
  }
}
