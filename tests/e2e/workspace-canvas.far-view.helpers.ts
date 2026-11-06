import { expect, type Locator, type Page } from '@playwright/test'

export async function setZoom(window: Page, zoom: number): Promise<void> {
  expect(
    await window.evaluate(next => window.__opencoveWorkspaceCanvasTestApi?.setZoom(next), zoom),
  ).toBe(true)
}

export const lodOf = (window: Page): Promise<string | null> =>
  window.locator('.workspace-canvas').evaluate(canvas => canvas.getAttribute('data-cove-lod'))

/**
 * A far tile's face as drawn on screen: the icon's width and the title's font size in screen px
 * (null when hidden), and how many lines the title takes.
 */
export async function readFarTileFace(tile: Locator) {
  return await tile.evaluate(element => {
    const shown = (selector: string) => {
      const part = element.querySelector<HTMLElement>(selector)
      return part && part.getClientRects().length > 0 ? part : null
    }
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
    }
  })
}
