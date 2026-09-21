import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const rows = (page: Page) => page.locator('[data-testid^="settings-agent-order-item-"]')
const row = (page: Page, provider: string) =>
  page.getByTestId(`settings-agent-order-item-${provider}`)
const handle = (page: Page, provider: string) =>
  page.getByTestId(`settings-agent-drag-handle-${provider}`)

async function beginKeyboardSort(page: Page, provider: string) {
  await page.keyboard.press('Space')
  await expect(handle(page, provider)).toHaveAttribute('aria-pressed', 'true')
  // The keyboard sensor attaches its document listener in a deferred task.
  await page.evaluate(() => new Promise<void>(resolve => window.setTimeout(resolve, 0)))
}

async function openAgents(page: Page) {
  await page.getByTestId('app-header-settings').click()
  await page.getByTestId('settings-section-nav-agent').click()
  await expect(rows(page)).toHaveCount(5)
}

async function readPreference(page: Page) {
  return await page.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const settings = raw ? JSON.parse(raw).settings : null
    return settings
      ? {
          defaultProvider: settings.defaultProvider,
          agentProviderOrder: settings.agentProviderOrder,
        }
      : null
  })
}

test.describe('Agent preference order', () => {
  test('supports handle-only pointer and keyboard sorting, cancellation, and reload', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()
    try {
      await clearAndSeedWorkspace(window, [], {
        settings: {
          defaultProvider: 'pi',
          agentProviderOrder: ['codex', 'gemini', 'claude-code', 'opencode', 'pi', 'kimi'],
          uiTheme: 'pixel',
        },
      })
      await openAgents(window)
      await expect(rows(window).first()).toHaveAttribute(
        'data-testid',
        'settings-agent-order-item-pi',
      )
      await expect(row(window, 'pi')).toHaveAttribute('data-default', 'true')
      await expect(window.locator('[name="settings-default-provider"]')).toHaveCount(0)

      const pi = handle(window, 'pi')
      await pi.focus()
      await beginKeyboardSort(window, 'pi')
      await expect(
        window.locator('[id^="DndLiveRegion"]').filter({ hasText: 'Pi moved to position 1.' }),
      ).toHaveCount(1)
      await window.keyboard.press('ArrowDown')
      await expect(
        window.locator('[id^="DndLiveRegion"]').filter({ hasText: 'Pi moved to position 2.' }),
      ).toHaveCount(1)
      await window.keyboard.press('Space')
      await expect(rows(window).first()).toHaveAttribute(
        'data-testid',
        'settings-agent-order-item-codex',
      )
      await expect(row(window, 'codex')).toHaveAttribute('data-default', 'true')
      await expect(pi).toBeFocused()
      await expect
        .poll(() => readPreference(window))
        .toEqual({
          defaultProvider: 'codex',
          agentProviderOrder: ['codex', 'gemini', 'pi', 'claude-code', 'opencode', 'kimi'],
        })

      await beginKeyboardSort(window, 'pi')
      await expect(
        window.locator('[id^="DndLiveRegion"]').filter({ hasText: 'Pi moved to position 2.' }),
      ).toHaveCount(1)
      await window.keyboard.press('ArrowDown')
      await expect(
        window.locator('[id^="DndLiveRegion"]').filter({ hasText: 'Pi moved to position 3.' }),
      ).toHaveCount(1)
      await window.keyboard.press('Escape')
      await expect(window.getByTestId('settings-panel')).toBeVisible()
      await expect(pi).not.toHaveAttribute('aria-pressed', 'true')
      await expect(rows(window).nth(1)).toHaveAttribute(
        'data-testid',
        'settings-agent-order-item-pi',
      )

      const start = await handle(window, 'opencode').evaluate(element => {
        const box = element.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      })
      const end = await handle(window, 'codex').evaluate(element => {
        const box = element.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      })
      await window.mouse.move(start.x, start.y)
      await window.mouse.down()
      await window.mouse.move(start.x, start.y - 3)
      await expect(handle(window, 'opencode')).not.toHaveAttribute('aria-pressed', 'true')
      await window.mouse.move(end.x, end.y, { steps: 18 })
      await expect(handle(window, 'opencode')).toHaveAttribute('aria-pressed', 'true')
      await window.mouse.up()
      await expect(rows(window).first()).toHaveAttribute(
        'data-testid',
        'settings-agent-order-item-opencode',
      )
      await expect
        .poll(() => readPreference(window))
        .toEqual({
          defaultProvider: 'opencode',
          agentProviderOrder: ['opencode', 'gemini', 'codex', 'pi', 'claude-code', 'kimi'],
        })
      await testInfo.attach('agent-order-pixel', {
        body: await window.getByTestId('settings-panel').screenshot(),
        contentType: 'image/png',
      })
      await window.reload({ waitUntil: 'domcontentloaded' })
      await openAgents(window)
      await expect(rows(window).first()).toHaveAttribute(
        'data-testid',
        'settings-agent-order-item-opencode',
      )
      await expect(row(window, 'opencode')).toHaveAttribute('data-default', 'true')
    } finally {
      await electronApp.close()
    }
  })

  for (const theme of ['pixel', 'pixel-light']) {
    test(`keeps large-font rows compact with long model names in ${theme}`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const { electronApp, window } = await launchApp()
      try {
        await clearAndSeedWorkspace(window, [], {
          settings: {
            uiTheme: theme,
            uiFontSize: 24,
            customModelEnabledByProvider: { codex: true, pi: true },
            customModelByProvider: {
              codex: 'provider/research-model-with-a-long-name-and-context-window-2026',
              pi: 'short-model',
            },
          },
        })
        await openAgents(window)
        const verifyWidth = async (width: number) => {
          await electronApp.evaluate(({ BrowserWindow }, size) => {
            BrowserWindow.getAllWindows()[0]?.setContentSize(size, 800)
          }, width)
          await expect.poll(async () => await window.evaluate(() => window.innerWidth)).toBe(width)
          const metrics = await rows(window).evaluateAll(elements =>
            elements.map(element => {
              const summary = element.querySelector('.settings-agent-list-row__summary')!
              return {
                height: element.getBoundingClientRect().height,
                width: element.clientWidth,
                scrollWidth: element.scrollWidth,
                summaryFlexBasis: getComputedStyle(summary).flexBasis,
              }
            }),
          )
          for (const metric of metrics) {
            expect(metric.height).toBeLessThan(125)
            expect(metric.height).toBeGreaterThanOrEqual(64)
            expect(metric.scrollWidth).toBeLessThanOrEqual(metric.width + 1)
            expect(metric.summaryFlexBasis).toBe('auto')
          }
          const geometry = await window.getByTestId('settings-panel').evaluate(element => {
            const header = element.querySelector('.settings-panel__header')!.getBoundingClientRect()
            const content = element
              .querySelector('.settings-panel__content')!
              .getBoundingClientRect()
            const search = element
              .querySelector('[data-testid="settings-panel-search"]')!
              .getBoundingClientRect()
            const tabs = element.querySelector('.settings-panel__tabs')!.getBoundingClientRect()
            return {
              headerTop: header.top,
              headerBottom: header.bottom,
              contentTop: content.top,
              searchTop: search.top,
              searchBottom: search.bottom,
              tabsTop: tabs.top,
            }
          })
          expect(geometry.headerBottom).toBeLessThanOrEqual(geometry.contentTop + 1)
          expect(geometry.searchBottom).toBeLessThanOrEqual(geometry.headerBottom + 1)
          await testInfo.attach(`agent-list-${theme}-${width}`, {
            body: await window.getByTestId('settings-panel').screenshot(),
            contentType: 'image/png',
          })
        }
        await verifyWidth(1120)
        await verifyWidth(720)
      } finally {
        await electronApp.close()
      }
    })
  }
})
