import { expect, type Page } from '@playwright/test'
import { dragHeaderDragSurfaceTo, readLocatorClientRect } from './workspace-canvas.gestures'
import {
  readContinuityDiagnostics,
  waitForManagedLayoutWrite,
  waitForManagedNodeMovement,
} from './managedClaudeContinuityDiagnostics'

/** Exercise the same verified drag surface before and after the Worker changes the binding. */
export async function publishManagedLayout(page: Page, nodeId: string, stale: boolean) {
  const header = page.locator(`.react-flow__node[data-id="${nodeId}"] .terminal-node__header`)
  const pane = page.locator('.react-flow__pane')
  // Check the actual grab tile before sampling coordinates. A visible header can
  // still be moving or obscured in this client's viewport.
  await header.getByTestId('terminal-node-header-drag-surface').hover()
  const [source, target] = await Promise.all([
    readLocatorClientRect(header),
    readLocatorClientRect(pane),
  ])
  const log = await readContinuityDiagnostics(page)
  const before = [...(log.reads ?? [])].reverse().find(read => read.route === 'public')
    ?.candidate?.position
  if (!before || !log.node.transform) {
    throw new Error(`The client has no layout baseline. ${JSON.stringify(log)}`)
  }
  const x = source.x - target.x
  const y = source.y - target.y
  const pointer = await header.evaluateHandle(element => {
    let evidence: Record<string, unknown> | null = null
    const capture = (event: PointerEvent) => {
      const hit = event.target instanceof Element ? event.target : null
      const surface = element.querySelector('[data-testid="terminal-node-header-drag-surface"]')
      evidence = {
        hitSurface: hit !== null && surface?.contains(hit) === true,
        point: { x: event.clientX, y: event.clientY },
        target: hit?.outerHTML.slice(0, 500),
        header: element.getBoundingClientRect().toJSON(),
        viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style'),
      }
    }
    document.addEventListener('pointerdown', capture, { capture: true, once: true })
    return {
      read: () => evidence,
      dispose: () => document.removeEventListener('pointerdown', capture, true),
    }
  })
  try {
    await dragHeaderDragSurfaceTo(page, header, pane, {
      targetPosition: {
        x: Math.max(40, Math.min(target.width - 40, x + (x > target.width / 2 ? -220 : 220))),
        y: Math.max(40, Math.min(target.height - 40, y + (y > target.height / 2 ? -140 : 140))),
      },
    })
    const evidence = await pointer.evaluate(observer => observer.read())
    expect(evidence, `Managed header pointerdown: ${JSON.stringify(evidence)}`).toMatchObject({
      hitSurface: true,
    })
  } finally {
    await pointer.evaluate(observer => observer.dispose())
    await pointer.dispose()
  }
  await waitForManagedNodeMovement(page, log.node.transform)
  return await waitForManagedLayoutWrite(page, { afterSeq: log.seq ?? 0, before, stale })
}
