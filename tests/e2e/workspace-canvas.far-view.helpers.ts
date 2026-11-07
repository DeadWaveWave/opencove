import { expect, type Locator, type Page } from '@playwright/test'
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
  return await window.locator('.workspace-canvas .react-flow__pane').evaluate(
    async (pane, gesture) => {
      const rect = pane.getBoundingClientRect()
      const clientX = rect.left + gesture.point.x
      const clientY = rect.top + gesture.point.y
      if (document.elementFromPoint(clientX, clientY) !== pane) {
        throw new Error('Continuous wheel gesture must hit the canvas pane')
      }
      // Input and the freeze debounce share the renderer clock. A descheduled test runner
      // must neither split one gesture into two nor sample "during" after it has thawed.
      for (let step = 0; step < 15; step += 1) {
        if (gesture.reactivate && step === 5) {
          // Force a real background Worker refresh during the gesture. Only workspace metadata
          // changes: deserialized task arrays must not rebuild task or website chrome.
          // eslint-disable-next-line no-await-in-loop -- One refresh is ordered within the gesture.
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          const state = JSON.parse(raw ?? '{}') as PersistedAppState
          const workspace = state.workspaces.find(item => item.id === gesture.workspaceId)
          if (!workspace) {
            throw new Error('Missing workspace for sync refresh')
          }
          workspace.name = gesture.workspaceName
          // eslint-disable-next-line no-await-in-loop -- Publish the same refresh before continuing.
          const result = await window.opencoveApi.persistence.writeWorkspaceStateRaw({
            raw: JSON.stringify(state),
          })
          if (!result.ok) {
            throw new Error('Failed to publish workspace sync refresh')
          }
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
      return window.__opencoveWorkspaceCanvasTestApi!.getWindowCommitCounts()
    },
    { deltaY, point, reactivate, workspaceId: seededWorkspaceId, workspaceName: SYNC_REFRESH_NAME },
  )
}
