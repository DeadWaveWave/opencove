import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { dragMouse, launchApp, readLocatorClientRect } from './workspace-canvas.helpers'
import {
  createFilesystemNodeFixture,
  directoryEntry,
  dragEntryToCanvas,
  FILESYSTEM_SPACE,
  seedFilesystemWorkspace,
} from './workspace-canvas.filesystem-nodes.helpers'

type BrowserKind = 'explorer' | 'folder'

async function openDirectoryBrowser(
  page: Page,
  fixture: Awaited<ReturnType<typeof createFilesystemNodeFixture>>,
  kind: BrowserKind,
) {
  const explorer = page.getByTestId('workspace-space-explorer')
  if (kind === 'explorer') {
    await expect(explorer.locator('.workspace-space-explorer__title')).toHaveText(
      'Source workspace',
    )
    await explorer.getByRole('radio', { name: 'Icons', exact: true }).click()
    await directoryEntry(page, FILESYSTEM_SPACE, fixture.docs).click()
    return { browser: explorer, ownerId: FILESYSTEM_SPACE }
  }

  await dragEntryToCanvas(page, directoryEntry(page, FILESYSTEM_SPACE, fixture.docs))
  const host = page.locator('.react-flow__node').filter({ has: page.locator('.folder-node') })
  await expect(host).toHaveCount(1)
  const ownerId = await host.getAttribute('data-id')
  if (!ownerId) {
    throw new Error('The dragged folder has no node identity')
  }
  await explorer.locator('header').getByRole('button', { name: 'Close', exact: true }).click()
  await host.getByTestId('node-expand').click()
  await expect(host.locator('[data-cove-collapse-motion]')).toHaveCount(0)
  await page.locator('.react-flow__controls-fitview').click()
  return { browser: host.locator('.folder-node'), ownerId }
}

async function resizeBrowser(page: Page, browser: Locator, kind: BrowserKind, width: number) {
  // Fit View and compact-window expansion both animate geometry. Read the scale only
  // after their visible frame settles, and keep all measurements in the same snapshot.
  const { beforeWidth, scale } = await browser.evaluate(element => {
    const node = element as HTMLElement
    return new Promise<{ beforeWidth: number; scale: number }>((resolve, reject) => {
      let previous = ''
      let stableFrames = 0
      let frame = 0
      const sample = () => {
        const rect = node.getBoundingClientRect()
        const next = [rect.x, rect.y, rect.width, rect.height]
          .map(value => value.toFixed(2))
          .join(',')
        stableFrames = next === previous ? stableFrames + 1 : 0
        previous = next
        if (stableFrames >= 4) {
          resolve({ beforeWidth: rect.width, scale: rect.width / node.offsetWidth })
        } else if (++frame >= 120) {
          reject(new Error('Directory frame did not settle before resize'))
        } else {
          requestAnimationFrame(sample)
        }
      }
      requestAnimationFrame(sample)
    })
  })
  const handle =
    kind === 'explorer'
      ? browser.getByTestId('workspace-space-explorer-resizer-right')
      : browser.getByTestId('folder-resizer-right')
  // Fit View can place the midpoint behind the floating creation toolbar. Use
  // an exposed part of the real handle, as a user would, instead of dragging
  // a toolbar button and accidentally creating another node.
  const start = await handle.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return [0.5, 0.25, 0.75, 0.1, 0.9]
      .map(fraction => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height * fraction }))
      .find(point => element.contains(document.elementFromPoint(point.x, point.y)))
  })
  if (!start) {
    throw new Error('No exposed directory resize handle is available')
  }
  await dragMouse(page, {
    start,
    end: { x: start.x + width * scale - beforeWidth, y: start.y },
  })
  await expect
    .poll(() => browser.evaluate(element => (element as HTMLElement).offsetWidth))
    .toBeCloseTo(width, 0)
}

async function expectSingleToolbarRow(browser: Locator) {
  const metrics = await browser.evaluate(element => {
    const header = element.querySelector('header')!
    const toolbar = element.querySelector<HTMLElement>('.workspace-space-explorer__toolbar')!
    const tools = toolbar.querySelector<HTMLElement>('.workspace-space-explorer__tools')!
    const headerBox = header.getBoundingClientRect()
    const toolbarBox = toolbar.getBoundingClientRect()
    const buttons = Array.from(tools.querySelectorAll('button')).map(button => {
      const rect = button.getBoundingClientRect()
      return rect.y + rect.height / 2
    })
    return {
      headerHeight: headerBox.height,
      toolbarHeight: toolbarBox.height,
      scrollHeight: toolbar.scrollHeight,
      clientHeight: toolbar.clientHeight,
      buttonCenters: buttons,
    }
  })
  expect(metrics.toolbarHeight).toBeLessThanOrEqual(metrics.headerHeight + 1)
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1)
  expect(Math.max(...metrics.buttonCenters) - Math.min(...metrics.buttonCenters)).toBeLessThan(1)
}

async function expectHeaderAndFooter(browser: Locator) {
  const header = browser.locator('header').first()
  await expect(header.locator('.workspace-space-explorer__subtitle, .lucide-scan')).toHaveCount(0)
  await expect(browser.getByRole('button', { name: 'Parent folder', exact: true })).toHaveCount(0)
  const icons = header.getByRole('radio', { name: 'Icons', exact: true })
  const list = header.getByRole('radio', { name: 'List', exact: true })
  const close = header.getByRole('button', { name: 'Close', exact: true })
  await expect(icons).toBeVisible()
  await expect(list).toBeVisible()
  const [iconsBox, listBox, closeBox] = await Promise.all(
    [icons, list, close].map(readLocatorClientRect),
  )
  expect(iconsBox.x + iconsBox.width).toBeLessThanOrEqual(listBox.x + 1)
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(closeBox.x + 1)
  expect(
    Math.abs(iconsBox.y + iconsBox.height / 2 - closeBox.y - closeBox.height / 2),
  ).toBeLessThan(1)

  const pathNavigation = browser.getByRole('navigation', { name: 'Path', exact: true })
  await expect(pathNavigation).toContainText('/')
  const placement = await pathNavigation.evaluate(element => {
    const container = element.closest('.folder-node, .workspace-space-explorer')!
    const tree = container.querySelector('[data-testid="workspace-space-explorer-tree"]')!
    const navRect = element.getBoundingClientRect()
    const treeRect = tree.getBoundingClientRect()
    const browserRect = container.getBoundingClientRect()
    const currentCrumb = element.querySelector('[aria-current]')!.getBoundingClientRect()
    return {
      followsTree: Boolean(
        tree.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      belowTree: navRect.top >= treeRect.bottom - 1,
      currentPathVisible: currentCrumb.right <= navRect.right + 1,
      bottomGap: browserRect.bottom - navRect.bottom,
    }
  })
  expect(placement.followsTree).toBe(true)
  expect(placement.belowTree).toBe(true)
  expect(placement.currentPathVisible).toBe(true)
  expect(placement.bottomGap).toBeGreaterThanOrEqual(0)
  expect(placement.bottomGap).toBeLessThan(24)
  await expectSingleToolbarRow(browser)
}

async function exerciseSearch(
  page: Page,
  browser: Locator,
  ownerId: string,
  docs: string,
  hidesTools: boolean,
) {
  const toggle = browser.getByTestId('workspace-space-explorer-filter-toggle')
  const input = browser.getByTestId('workspace-space-explorer-filter-input')
  const tools = browser.locator('.workspace-space-explorer__tools')
  await expect(toggle).toBeVisible()
  await expect(input).toBeHidden()
  await toggle.click()
  await expect(input).toBeFocused()
  await input.fill('note2')
  await expect(directoryEntry(page, ownerId, path.join(docs, 'note2.md'))).toBeVisible()
  await expect(directoryEntry(page, ownerId, path.join(docs, 'note10.md'))).toHaveCount(0)
  await expect(tools).toHaveCSS('opacity', hidesTools ? '0' : '1')
  if (hidesTools) {
    await expect(tools).toHaveCSS('pointer-events', 'none')
  } else {
    await expect(tools).not.toHaveCSS('pointer-events', 'none')
  }
  await expectSingleToolbarRow(browser)

  // Losing focus collapses the search field without silently removing its filter.
  await browser.locator('.workspace-space-explorer__identity, .document-node__title').click()
  await expect(toggle).toBeVisible()
  await expect(input).toBeHidden()
  await expect(tools).toHaveCSS('opacity', '1')
  await expect(tools).not.toHaveCSS('pointer-events', 'none')
  await expect(directoryEntry(page, ownerId, path.join(docs, 'note10.md'))).toHaveCount(0)
  await toggle.click()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('note2')
  await browser.getByRole('button', { name: 'Clear filter', exact: true }).click()
  await expect(input).toHaveValue('')
  await expect(directoryEntry(page, ownerId, path.join(docs, 'note10.md'))).toBeVisible()
  await browser.locator('.workspace-space-explorer__identity, .document-node__title').click()
  await expect(input).toBeHidden()
  await expectSingleToolbarRow(browser)
}

for (const theme of ['pixel', 'pixel-light'] as const) {
  for (const kind of ['explorer', 'folder'] as const) {
    test(`${kind} keeps stable directory chrome and compact search in ${theme}`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const fixture = await createFilesystemNodeFixture()
      const { electronApp, window } = await launchApp({
        env: { OPENCOVE_TEST_WORKSPACE: fixture.root },
      })
      try {
        await seedFilesystemWorkspace(window, fixture.root, theme)
        const { browser, ownerId } = await openDirectoryBrowser(window, fixture, kind)
        const title = browser.locator(
          '.workspace-space-explorer__title, .document-node__title-text',
        )
        await expect(title).toHaveText('docs')
        await resizeBrowser(window, browser, kind, kind === 'explorer' ? 440 : 516)
        await expectHeaderAndFooter(browser)
        const header = await browser.locator('header').first().elementHandle()
        const footer = await browser
          .getByRole('navigation', { name: 'Path', exact: true })
          .elementHandle()
        const background = await browser.locator('.cove-directory-browser').elementHandle()
        expect(header).not.toBeNull()
        expect(footer).not.toBeNull()
        expect(background).not.toBeNull()

        await browser.locator('header').getByRole('radio', { name: 'Icons', exact: true }).click()
        await directoryEntry(window, ownerId, fixture.design).click()
        await expect(directoryEntry(window, ownerId, fixture.guide)).toBeVisible()
        await expect(title).toHaveText('design')
        await expect(browser.getByRole('navigation', { name: 'Path', exact: true })).toContainText(
          'design',
        )
        expect(await header!.evaluate(element => element.isConnected)).toBe(true)
        expect(await footer!.evaluate(element => element.isConnected)).toBe(true)
        expect(await background!.evaluate(element => element.isConnected)).toBe(true)

        await browser
          .getByRole('navigation', { name: 'Path', exact: true })
          .getByRole('button', { name: 'docs', exact: true })
          .press('Enter')
        await expect(directoryEntry(window, ownerId, fixture.design)).toBeVisible()
        await expect(title).toHaveText('docs')
        await browser
          .getByRole('navigation', { name: 'Path', exact: true })
          .getByRole('button', { name: path.basename(fixture.root), exact: true })
          .press('Enter')
        await expect(directoryEntry(window, ownerId, fixture.readme)).toBeVisible()
        await expect(title).toHaveText(
          kind === 'explorer' ? 'Source workspace' : path.basename(fixture.root),
        )
        await directoryEntry(window, ownerId, fixture.docs).click()
        await expect(title).toHaveText('docs')
        // Space checks a focused radio, as in native segmented controls.
        await browser
          .locator('header')
          .getByRole('radio', { name: 'List', exact: true })
          .press('Space')
        await expect(browser.getByRole('tree')).toBeVisible()
        expect(await header!.evaluate(element => element.isConnected)).toBe(true)
        expect(await footer!.evaluate(element => element.isConnected)).toBe(true)
        expect(await background!.evaluate(element => element.isConnected)).toBe(true)

        await resizeBrowser(window, browser, kind, kind === 'explorer' ? 224 : 360)
        await expectHeaderAndFooter(browser)
        await exerciseSearch(window, browser, ownerId, fixture.docs, kind === 'explorer')
        await testInfo.attach(`${kind}-${theme}-narrow-chrome`, {
          body: await browser.screenshot({
            path: testInfo.outputPath(`${kind}-${theme}-chrome.png`),
            animations: 'disabled',
          }),
          contentType: 'image/png',
        })
      } finally {
        await electronApp.close()
        await fixture.cleanup()
      }
    })
  }
}
