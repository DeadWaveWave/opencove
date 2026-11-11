import type { Page } from '@playwright/test'
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
  await dragHeaderDragSurfaceTo(page, header, pane, {
    targetPosition: {
      x: Math.max(40, Math.min(target.width - 40, x + (x > target.width / 2 ? -220 : 220))),
      y: Math.max(40, Math.min(target.height - 40, y + (y > target.height / 2 ? -140 : 140))),
    },
  })
  await waitForManagedNodeMovement(page, log.node.transform)
  return await waitForManagedLayoutWrite(page, { afterSeq: log.seq ?? 0, before, stale })
}
