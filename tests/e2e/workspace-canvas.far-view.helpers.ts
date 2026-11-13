import { expect, test, type Locator, type Page } from '@playwright/test'
import type { PersistedAppState } from '../../src/contexts/workspace/presentation/renderer/types'
import { seededWorkspaceId } from './workspace-canvas.helpers'
import { hoverCanvasPane } from './workspace-canvas.zoom.helpers'

export const SYNC_REFRESH_NAME = 'Zoom sync refresh'

export async function setZoom(window: Page, zoom: number): Promise<void> {
  expect(
    await window.evaluate(next => window.__opencoveWorkspaceCanvasTestApi?.setZoom(next), zoom),
  ).toBe(true)
}

export const lodOf = (window: Page): Promise<string | null> =>
  window.locator('.workspace-canvas').evaluate(canvas => canvas.getAttribute('data-cove-lod'))

/**
 * A far tile's face as drawn on screen: the icon's width and the title's font size in screen px
 * (null when hidden), how many lines the title takes, and the face's content box in screen px
 * (what the face's container units measure).
 */
export async function readFarTileFace(tile: Locator) {
  return await tile.evaluate(element => {
    const shown = (selector: string) => {
      const part = element.querySelector<HTMLElement>(selector)
      return part && part.getClientRects().length > 0 ? part : null
    }
    const face = element.querySelector<HTMLElement>('.workspace-far-tile__face')!
    const faceStyle = getComputedStyle(face)
    const faceRect = face.getBoundingClientRect()
    const icon = shown('.workspace-far-tile__icon')
    const title = shown('.workspace-far-tile__title')
    const round = (value: number) => Math.round(value * 10) / 10
    const style = title ? getComputedStyle(title) : null
    // Layout height unrounded (offsetHeight rounds), against its height on screen.
    const height = style ? Number.parseFloat(style.height) : 0
    return {
      icon: icon ? round(icon.getBoundingClientRect().width) : null,
      title:
        title && style
          ? round(
              (Number.parseFloat(style.fontSize) * title.getBoundingClientRect().height) / height,
            )
          : null,
      lines: style ? Math.round(height / Number.parseFloat(style.lineHeight)) : 0,
      box: {
        width:
          faceRect.width -
          Number.parseFloat(faceStyle.paddingLeft) -
          Number.parseFloat(faceStyle.paddingRight),
        height:
          faceRect.height -
          Number.parseFloat(faceStyle.paddingTop) -
          Number.parseFloat(faceStyle.paddingBottom),
      },
    }
  })
}

export async function continuousWheelGesture(window: Page, deltaY: number, reactivate = false) {
  const point = await hoverCanvasPane(window)
  const result = await window.locator('.workspace-canvas .react-flow__pane').evaluate(
    async (pane, gesture) => {
      const timeline: Array<{ phase: string; at: number }> = []
      const mark = (phase: string) => timeline.push({ phase, at: performance.now() })
      const rect = pane.getBoundingClientRect()
      const clientX = rect.left + gesture.point.x
      const clientY = rect.top + gesture.point.y
      if (document.elementFromPoint(clientX, clientY) !== pane) {
        throw new Error('Continuous wheel gesture must hit the canvas pane')
      }
      // Input and the freeze debounce share the renderer clock. A descheduled test runner
      // must neither split one gesture into two nor sample "during" after it has thawed.
      const refreshWorkspace = async () => {
        mark('refresh:start')
        // Model a slow Worker reply. It must not pause wheel input for longer than the
        // website's thaw debounce and manufacture a second freeze/thaw pair.
        const [raw] = await Promise.all([
          window.opencoveApi.persistence.readWorkspaceStateRaw(),
          new Promise(resolve => setTimeout(resolve, 400)),
        ])
        mark('refresh:read')
        const state = JSON.parse(raw ?? '{}') as PersistedAppState
        const workspace = state.workspaces.find(item => item.id === gesture.workspaceId)
        if (!workspace) {
          throw new Error('Missing workspace for sync refresh')
        }
        workspace.name = gesture.workspaceName
        const published = await window.opencoveApi.persistence.writeWorkspaceStateRaw({
          raw: JSON.stringify(state),
        })
        if (!published.ok) {
          throw new Error('Failed to publish workspace sync refresh')
        }
        mark('refresh:end')
      }
      let refresh = Promise.resolve()
      let refreshError: string | null = null
      // Keep zooming through the delayed reply, retaining the Worker-refresh-during-zoom case.
      const steps = gesture.reactivate ? 30 : 15
      for (let step = 0; step < steps; step += 1) {
        if (gesture.reactivate && step === 5) {
          // Worker IO is background work, independent of the renderer's input cadence.
          // Retain its error and await completion below, without an unhandled rejection.
          refresh = refreshWorkspace().catch(error => {
            refreshError = String(error)
          })
        }
        if (gesture.reactivate && step % 4 === 3) {
          const website = document.querySelector('.website-node__viewport')
          if (!website) {
            throw new Error('Missing active website viewport')
          }
          // Re-enter the real activation path with the same selected website. Selection is
          // unchanged; republishing it must not rebuild every window during the gesture.
          website.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
        }
        mark(`wheel:${step}`)
        pane.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: gesture.deltaY,
            clientX,
            clientY,
            bubbles: true,
            cancelable: true,
          }),
        )
        // Let React commit each frame, including a regression on any intermediate wheel.
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      // Retain the during-gesture sample before waiting for any outstanding Worker reply.
      const counts = window.__opencoveWorkspaceCanvasTestApi!.getWindowCommitCounts()
      mark('wheel:end')
      await refresh
      return { counts, timeline, refreshError }
    },
    { deltaY, point, reactivate, workspaceId: seededWorkspaceId, workspaceName: SYNC_REFRESH_NAME },
  )
  await test.info().attach(reactivate ? 'active-wheel-timeline' : 'wheel-timeline', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  expect(result.refreshError).toBeNull()
  return result.counts
}
