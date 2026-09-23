/* eslint-disable no-await-in-loop -- Theme changes and real pointer interactions run in sequence. */
import { expect, test, type Locator } from '@playwright/test'
import { launchApp, selectCoveOption } from './workspace-canvas.helpers'
import {
  EXPANSION_PEER,
  EXPANSION_TERMINAL,
  seedExpansionFixture,
} from './workspace-canvas.collapse-expansion.helpers'
import { openPixelAppearance } from './workspace-canvas.pixel-effects.helpers'

async function readPaint(locator: Locator, pseudo?: string) {
  return locator.evaluate((element, pseudoElement) => {
    const style = getComputedStyle(element, pseudoElement)
    // CSS Color 4 may serialize as color(srgb ... / 0), rather than rgba(..., 0).
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    const alpha = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return context.getImageData(0, 0, 1, 1).data[3]
    }
    return {
      backgroundAlpha: alpha(style.backgroundColor),
      backgroundImage: style.backgroundImage,
      borderAlpha: alpha(style.borderTopColor),
      borderWidth: Number.parseFloat(style.borderTopWidth),
      outlineWidth: Number.parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
      opacity: Number.parseFloat(style.opacity),
    }
  }, pseudo)
}

async function expectTransparentHitArea(launch: Locator) {
  await expect
    .poll(() => readPaint(launch), {
      message: 'The full drag/click target stays invisible instead of painting a collision box',
    })
    .toMatchObject({
      backgroundAlpha: 0,
      backgroundImage: 'none',
      borderWidth: 0,
      outlineWidth: 0,
      boxShadow: 'none',
    })
}

test('compact desktop icons keep hover, selection and keyboard feedback local in both Pixel themes', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp()
  try {
    await seedExpansionFixture(window)
    for (const id of [EXPANSION_TERMINAL, EXPANSION_PEER]) {
      const node = window.locator(`.react-flow__node[data-id="${id}"]`)
      await node.getByTestId('node-collapse').click()
      await expect(window.getByTestId(`collapsed-node-${id}`)).toBeVisible()
      await expect(node.locator('.cove-node-presentation')).not.toHaveAttribute(
        'data-cove-collapse-motion',
      )
      await expect
        .poll(() =>
          node.evaluate(element => ({
            hitWidth: (element as HTMLElement).offsetWidth,
            iconWindowWidth:
              element.querySelector<HTMLElement>('.cove-collapsed-window')!.offsetWidth,
            launchWidth: element.querySelector<HTMLElement>('.cove-collapsed-window__launch')!
              .offsetWidth,
          })),
        )
        .toEqual({ hitWidth: 112, iconWindowWidth: 112, launchWidth: 112 })
    }

    const node = window.locator(`.react-flow__node[data-id="${EXPANSION_TERMINAL}"]`)
    const compact = window.getByTestId(`collapsed-node-${EXPANSION_TERMINAL}`)
    const launch = compact.getByTestId('node-expand')
    const icon = compact.locator('.cove-collapsed-window__icon')
    const title = compact.locator('.cove-collapsed-window__title')
    for (const theme of ['pixel', 'pixel-light'] as const) {
      if (theme === 'pixel-light') {
        await openPixelAppearance(window)
        await selectCoveOption(window, 'settings-ui-theme', theme)
        await window.locator('.settings-panel__close').click()
      }
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme-id', theme)
      await expect(compact).toHaveAttribute('data-status', 'connected')
      await expect(compact.locator('.cove-collapsed-window__status')).toHaveCount(0)
      await expect(compact).toHaveText('Live terminal')
      await expect(compact.locator('.cove-collapsed-window__pixel-corner > i')).toHaveCount(28)
      await window.mouse.move(1, 1)
      await expect(node).not.toHaveClass(/selected/)
      await expect.poll(async () => (await readPaint(icon, '::before')).opacity).toBe(0)
      await launch.hover({ position: { x: 12, y: 12 } })
      await expectTransparentHitArea(launch)
      await expect(compact.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
      await expect(compact.locator('.cove-collapsed-window__close')).toHaveCount(0)
      await expect
        .poll(async () => (await readPaint(icon, '::before')).opacity, {
          message: 'Hover lights only the icon pedestal',
        })
        .toBeGreaterThan(0)
      await testInfo.attach(`desktop-icon-hover-${theme}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })

      await launch.click({ modifiers: ['Shift'] })
      await expect(node).toHaveClass(/selected/)
      await expect(compact).toBeVisible()
      await expect(launch).toHaveAttribute('aria-expanded', 'false')
      await window.mouse.move(1, 1)
      await expectTransparentHitArea(launch)
      await expect.poll(async () => (await readPaint(title)).backgroundAlpha).toBeGreaterThan(0)
      await expect.poll(async () => (await readPaint(icon, '::before')).opacity).toBeGreaterThan(0)
      await expect
        .poll(() => readPaint(window.locator('.react-flow__nodesselection-rect')), {
          message: 'A compact-only selection keeps its geometry without a visible outer rectangle',
        })
        .toMatchObject({ backgroundAlpha: 0, borderAlpha: 0 })
      await testInfo.attach(`desktop-icon-selected-${theme}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
      await launch.click({ modifiers: ['Shift'] })
      await expect(node).not.toHaveClass(/selected/)

      await window.keyboard.press('Tab')
      await launch.focus()
      await expect(launch).toBeFocused()
      await expect
        .poll(() => launch.evaluate(element => element.matches(':focus-visible')))
        .toBe(true)
      await expectTransparentHitArea(launch)
      await expect.poll(async () => (await readPaint(icon)).outlineWidth).toBeGreaterThan(0)
      await testInfo.attach(`desktop-icon-keyboard-${theme}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
      await window.keyboard.press('Enter')
      await expect(compact).toBeHidden()
      await node.getByTestId('node-collapse').click()
      await expect(compact).toBeVisible()
      await expect(node.locator('.cove-node-presentation')).not.toHaveAttribute(
        'data-cove-collapse-motion',
      )
    }

    const note = window.locator(`.react-flow__node[data-id="${EXPANSION_PEER}"]`)
    const compactNote = window.getByTestId(`collapsed-node-${EXPANSION_PEER}`)
    await compactNote.getByTestId('node-expand').click({ button: 'right' })
    await expect(compactNote).toBeVisible()
    await expect(window.getByTestId('workspace-node-close')).toHaveText('Close')
    await window.getByTestId('workspace-node-close').click()
    await expect(note).toHaveCount(0)
    await expect(compact).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
