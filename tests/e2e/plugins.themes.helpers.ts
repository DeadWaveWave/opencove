import { expect, type Locator, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, testWorkspacePath } from './workspace-canvas.helpers'

export { createThemePlugin, themePluginId, themeIdentity } from '../helpers/pluginThemeFixture'
export const themeNoteId = 'theme-expanded-note'
export const themeCompactId = 'theme-compact-note'
export const themeSpaceId = 'theme-space'

export async function seedThemeWorkspace(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await clearAndSeedWorkspace(
    page,
    [
      {
        id: themeNoteId,
        kind: 'note',
        title: 'Visual reference',
        position: { x: 100, y: 110 },
        width: 380,
        height: 260,
        task: { text: 'The host owns geometry.' },
      },
      {
        id: themeCompactId,
        kind: 'note',
        title: 'Compact reference',
        position: { x: 540, y: 120 },
        width: 320,
        height: 240,
        task: { text: 'Keep the compact collision bounds.' },
      },
    ],
    {
      settings: {
        language: 'en',
        uiTheme: 'pixel',
        uiFontSize: 16,
        canvasInputMode: 'mouse',
        focusNodeOnClick: false,
        nodeCreationPixelEffectEnabled: false,
      },
      spaces: [
        {
          id: themeSpaceId,
          name: 'Theme space',
          directoryPath: testWorkspacePath,
          nodeIds: [themeNoteId, themeCompactId],
          rect: { x: 70, y: 75, width: 830, height: 340 },
        },
      ],
    },
  )
  await page
    .locator(`.react-flow__node[data-id="${themeCompactId}"]`)
    .getByTestId('node-collapse')
    .click()
  await expect(page.getByTestId(`collapsed-node-${themeCompactId}`)).toBeVisible()
  await expect(page.locator('[data-cove-collapse-motion]')).toHaveCount(0)
}

export async function chooseTheme(page: Page, themeId: string) {
  await page.getByTestId('app-header-settings').click()
  await page.getByTestId('settings-section-nav-appearance').click()
  await page.getByTestId(`settings-ui-theme-${themeId}`).click()
  await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', themeId)
  await page.locator('.settings-panel__close').click()
  await page.mouse.move(1, 1)
}

export async function readThemePaint(page: Page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const timing = animation.effect?.getComputedTiming()
      if (typeof timing?.endTime === 'number' && Number.isFinite(timing.endTime)) {
        try {
          animation.finish()
        } catch {
          /* Non-finishable effects are not visual transitions. */
        }
      }
    }
  })
  return page.evaluate(
    ({ note, compact, space }) => {
      const paint = (selector: string, pseudo?: string) => {
        const element = document.querySelector(selector)
        if (!element) {
          throw new Error(`Missing visual part ${selector}`)
        }
        const style = getComputedStyle(element, pseudo)
        return Object.fromEntries(
          [
            'backgroundColor',
            'backgroundImage',
            'borderColor',
            'borderRadius',
            'boxShadow',
            'backdropFilter',
            'color',
            'fontSize',
            'fontFamily',
            'height',
          ].map(key => [key, style[key as keyof CSSStyleDeclaration]]),
        )
      }
      return {
        window: paint(`[data-id="${note}"] [data-cove-part="window"]`),
        header: paint(`[data-id="${note}"] [data-cove-part="window-header"]`),
        title: paint(`[data-id="${note}"] [data-cove-part="window-title"]`),
        space: paint(`[data-testid="workspace-space-region-${space}"]`),
        corners: paint(`[data-testid="workspace-space-region-${space}"]`, '::after'),
        compact: paint(`[data-testid="collapsed-node-${compact}"] [data-cove-part="compact-base"]`),
        sidebar: paint('[data-cove-part="sidebar"]'),
      }
    },
    { note: themeNoteId, compact: themeCompactId, space: themeSpaceId },
  )
}

export async function layoutSize(locator: Locator) {
  return locator.evaluate(element => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }))
}
