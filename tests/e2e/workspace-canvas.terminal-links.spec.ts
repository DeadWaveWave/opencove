import { expect, test, type ElectronApplication } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'
import {
  clearTerminalLinkSelection,
  printTerminalLinkFixture,
  terminalLinkCellPoint,
} from './workspace-canvas.terminal-links.helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const actionsSelector = '[data-testid="terminal-link-actions"][role="dialog"]'

type LinkCaptureGlobal = typeof globalThis & { __opencoveLinkOpenCalls?: string[] }

async function captureExternalLinks(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const state = globalThis as LinkCaptureGlobal
    state.__opencoveLinkOpenCalls = []
    shell.openExternal = async uri => {
      state.__opencoveLinkOpenCalls?.push(uri)
    }
  })
}

async function readExternalLinks(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as LinkCaptureGlobal).__opencoveLinkOpenCalls ?? [])
}

test.describe('Workspace Canvas - Terminal Links', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`plain click offers actions and modifier click opens once in ${theme} theme`, async ({
      browserName,
    }, testInfo) => {
      void browserName
      const { electronApp, window } = await launchApp()
      const nodeId = `node-terminal-link-${theme}`
      const uri = 'https://example.com/path?q=hello&lang=zh'
      try {
        await captureExternalLinks(electronApp)
        await clearAndSeedWorkspace(
          window,
          [
            {
              id: nodeId,
              title: 'terminal-links',
              position: { x: 120, y: 100 },
              width: 620,
              height: 340,
            },
          ],
          { settings: { uiTheme: theme } },
        )
        await printTerminalLinkFixture(window, nodeId, `中文 ${uri}`, {
          inputResponses: ['\x1b[3;1HOTHER_ROW_OUTPUT'],
        })
        const terminal = window.locator(`[data-id="${nodeId}"] .terminal-node`)
        const input = terminal.locator('.xterm-helper-textarea')
        const point = await terminalLinkCellPoint(window, nodeId, 9, 1)
        await window.mouse.move(point.x, point.y)
        const tooltip = terminal.getByRole('tooltip')
        await expect(tooltip).toBeVisible()
        await expect(tooltip).toHaveAttribute('title', uri)
        await expect(tooltip).toContainText(uri)
        const paneBounds = await terminal.boundingBox()
        const tooltipBounds = await tooltip.boundingBox()
        expect(paneBounds).not.toBeNull()
        expect(tooltipBounds).not.toBeNull()
        expect(Math.abs(tooltipBounds!.x - paneBounds!.x)).toBeLessThan(3)
        expect(
          Math.abs(tooltipBounds!.y + tooltipBounds!.height - paneBounds!.y - paneBounds!.height),
        ).toBeLessThan(3)
        expect(tooltipBounds!.width).toBeLessThanOrEqual(paneBounds!.width * 0.81)
        const hoverScreenshot = testInfo.outputPath(`terminal-link-hover-${theme}.png`)
        await window.screenshot({ path: hoverScreenshot })
        await testInfo.attach(`terminal-link-hover-${theme}`, {
          path: hoverScreenshot,
          contentType: 'image/png',
        })
        await window.mouse.click(point.x, point.y)
        const actions = window.locator(actionsSelector)
        await expect(actions).toBeVisible()
        await expect(actions).toContainText(uri)
        await expect(input).toBeFocused()
        await expect(actions.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
        const primary = actions.getByRole('button', { name: 'Open in browser', exact: true })
        await expect(primary).toBeVisible()
        await expect(actions.locator('.terminal-link-card__target')).toHaveAttribute('title', uri)
        const menuBounds = await actions.boundingBox()
        const primaryBounds = await primary.boundingBox()
        const headerBounds = await actions.locator('.terminal-link-card__header').boundingBox()
        const copyBounds = await actions
          .getByRole('button', { name: 'Copy', exact: true })
          .boundingBox()
        expect(menuBounds).not.toBeNull()
        expect(primaryBounds).not.toBeNull()
        expect(headerBounds).not.toBeNull()
        expect(copyBounds).not.toBeNull()
        expect(menuBounds!.width).toBeGreaterThanOrEqual(208)
        expect(menuBounds!.width).toBeLessThanOrEqual(274)
        expect(menuBounds!.height).toBeLessThan(140)
        expect(menuBounds!.y + menuBounds!.height).toBeLessThan(point.y)
        expect(primaryBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height)
        expect(primaryBounds!.width).toBeGreaterThan(menuBounds!.width * 0.9)
        expect(copyBounds!.width).toBeLessThanOrEqual(28)
        expect(await readExternalLinks(electronApp)).toEqual([])

        await window.keyboard.press('x')
        await expect
          .poll(() =>
            window.evaluate(
              id =>
                window.__opencoveTerminalSelectionTestApi?.getBufferText(id, 'OTHER_ROW_OUTPUT')
                  ?.viewportLines[2],
              nodeId,
            ),
          )
          .toContain('OTHER_ROW_OUTPUT')
        await expect(actions).toBeVisible()
        await expect(actions).toContainText(uri)

        const screenshot = testInfo.outputPath(`terminal-link-actions-${theme}.png`)
        await window.screenshot({ path: screenshot })
        await testInfo.attach(`terminal-link-actions-${theme}`, {
          path: screenshot,
          contentType: 'image/png',
        })
        await actions.getByRole('button', { name: 'Copy', exact: true }).click()
        await expect
          .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe(uri)
        await expect(actions).toBeHidden()
        await expect
          .poll(() =>
            window.evaluate(
              id => window.__opencoveTerminalSelectionTestApi?.hasSelection(id) ?? false,
              nodeId,
            ),
          )
          .toBe(false)

        const directPoint = await terminalLinkCellPoint(window, nodeId, 9, 1)
        await window.keyboard.down(modifier)
        await window.mouse.click(directPoint.x, directPoint.y)
        await window.keyboard.up(modifier)
        await expect.poll(() => readExternalLinks(electronApp)).toEqual([uri])
        await window.waitForTimeout(350)
        expect(await readExternalLinks(electronApp)).toEqual([uri])
        await expect(actions).toBeHidden()
      } finally {
        await electronApp.close()
      }
    })
  }

  test('all wrapped rows share one target at canvas zoom while drag and double-click keep selection', async () => {
    const { electronApp, window } = await launchApp()
    const nodeId = 'node-terminal-link-wrap'
    try {
      await captureExternalLinks(electronApp)
      await clearAndSeedWorkspace(window, [
        {
          id: nodeId,
          title: 'terminal-link-wrap',
          position: { x: 120, y: 100 },
          width: 430,
          height: 400,
        },
      ])
      await expect
        .poll(() =>
          window.evaluate(
            id => window.__opencoveTerminalSelectionTestApi?.getSize(id)?.cols ?? 0,
            nodeId,
          ),
        )
        .toBeGreaterThan(20)
      const cols = await window.evaluate(
        id => window.__opencoveTerminalSelectionTestApi!.getSize(id)!.cols,
        nodeId,
      )
      const uri = `https://example.com/${'a'.repeat(cols * 4)}/end`
      await printTerminalLinkFixture(window, nodeId, `中文 ${uri}`)

      await window.locator('.react-flow__controls-zoomin').click()
      await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBeGreaterThan(1)
      const actions = window.locator(actionsSelector)
      const lastRow = Math.ceil((uri.length + 5) / cols)
      expect(lastRow).toBeGreaterThanOrEqual(5)
      const checkRow = async (row: number): Promise<void> => {
        await clearTerminalLinkSelection(window, nodeId)
        const point = await terminalLinkCellPoint(window, nodeId, row === 1 ? 9 : 2, row)
        await window.mouse.click(point.x, point.y)
        await expect(actions).toBeVisible()
        await expect(actions.locator('.terminal-link-card__target')).toHaveText(uri)
        await window.keyboard.press('Escape')
        await expect(actions).toBeHidden()
        await expect(window.locator(`[data-id="${nodeId}"] .xterm-helper-textarea`)).toBeFocused()
      }
      await checkRow(1)
      await checkRow(3)
      await checkRow(lastRow)

      const start = await terminalLinkCellPoint(window, nodeId, 9, 1)
      const end = await terminalLinkCellPoint(window, nodeId, 17, 1)
      await window.mouse.move(start.x, start.y)
      await window.mouse.down()
      await window.mouse.move(end.x, end.y, { steps: 8 })
      await window.mouse.up()
      await expect
        .poll(() =>
          window.evaluate(
            id => window.__opencoveTerminalSelectionTestApi?.hasSelection(id) ?? false,
            nodeId,
          ),
        )
        .toBe(true)
      await expect(actions).toBeHidden()

      await clearTerminalLinkSelection(window, nodeId)
      await window.mouse.dblclick(start.x, start.y)
      await window.waitForTimeout(400)
      await expect(actions).toBeHidden()
      await expect
        .poll(() =>
          window.evaluate(
            id => window.__opencoveTerminalSelectionTestApi?.hasSelection(id) ?? false,
            nodeId,
          ),
        )
        .toBe(true)
      expect(await readExternalLinks(electronApp)).toEqual([])
    } finally {
      await electronApp.close()
    }
  })

  test('an OSC 8 label keeps its explicit destination after unrelated output', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    const nodeId = 'node-terminal-link-osc8'
    const uri = 'https://example.com/hidden-target?source=osc8'
    const replacementUri = 'https://example.com/replaced-target?source=osc8'
    const displayedUri = 'https://example.com/displayed-label'
    try {
      await captureExternalLinks(electronApp)
      await clearAndSeedWorkspace(window, [
        {
          id: nodeId,
          title: 'terminal-link-osc8',
          position: { x: 120, y: 100 },
          width: 620,
          height: 340,
        },
      ])
      await printTerminalLinkFixture(
        window,
        nodeId,
        `\x1b]8;;${uri}\x07${displayedUri}\x1b]8;;\x07\r\n\x1b]8;;${uri}\x07Open the report\x1b]8;;\x07`,
        {
          inputResponses: [
            '\x1b[3;1HUNRELATED_OUTPUT',
            `\x1b[1;1H\x1b]8;;${replacementUri}\x07${displayedUri}\x1b]8;;\x07`,
          ],
        },
      )
      const point = await terminalLinkCellPoint(window, nodeId, 5, 2)
      const tooltip = window.locator(`[data-id="${nodeId}"] .terminal-node`).getByRole('tooltip')
      await window.mouse.move(point.x, point.y)
      await expect(tooltip).toContainText(uri)
      await window.mouse.click(point.x, point.y)
      const actions = window.locator(actionsSelector)
      await expect(actions).toBeVisible()
      await expect(actions.locator('.terminal-link-card__target')).toHaveText(uri)
      await actions.getByRole('button', { name: 'Open in browser', exact: true }).click()
      await expect.poll(() => readExternalLinks(electronApp)).toEqual([uri])

      await window.locator(`[data-id="${nodeId}"] .xterm-helper-textarea`).focus()
      const urlPoint = await terminalLinkCellPoint(window, nodeId, 12, 1)
      await window.mouse.move(urlPoint.x, urlPoint.y)
      await expect(tooltip).toContainText(uri)
      await window.keyboard.press('x')
      await expect
        .poll(() =>
          window.evaluate(
            id =>
              window.__opencoveTerminalSelectionTestApi?.getBufferText(id, 'UNRELATED_OUTPUT')
                ?.viewportLines[2],
            nodeId,
          ),
        )
        .toContain('UNRELATED_OUTPUT')
      // The pointer remains in the same cell while a different row changes.
      await window.mouse.down()
      await window.mouse.up()
      await expect(actions).toBeVisible()
      await expect(actions.locator('.terminal-link-card__target')).toHaveText(uri)
      const screenshot = testInfo.outputPath('terminal-link-osc8-priority.png')
      await window.screenshot({ path: screenshot })
      await testInfo.attach('terminal-link-osc8-priority', {
        path: screenshot,
        contentType: 'image/png',
      })
      await actions.getByRole('button', { name: 'Open in browser', exact: true }).click()
      await expect.poll(() => readExternalLinks(electronApp)).toEqual([uri, uri])

      await window.locator(`[data-id="${nodeId}"] .xterm-helper-textarea`).focus()
      await window.mouse.move(urlPoint.x, urlPoint.y)
      // Returning to the same cell after leaving for the menu must retain OSC priority.
      await window.mouse.down()
      await window.mouse.up()
      await expect(actions).toBeVisible()
      await expect(actions.locator('.terminal-link-card__target')).toHaveText(uri)
      await actions.getByRole('button', { name: 'Open in browser', exact: true }).click()
      await expect.poll(() => readExternalLinks(electronApp)).toEqual([uri, uri, uri])

      await window.locator(`[data-id="${nodeId}"] .xterm-helper-textarea`).focus()
      await window.mouse.move(urlPoint.x, urlPoint.y)
      await window.keyboard.press('x')
      // The displayed text/cells are identical, so a text fingerprint alone is insufficient.
      const replacementPoint = await terminalLinkCellPoint(window, nodeId, 13, 1)
      await window.mouse.move(replacementPoint.x, replacementPoint.y)
      await expect(tooltip).toContainText(replacementUri)
      await window.keyboard.down(modifier)
      await window.mouse.down()
      await window.mouse.up()
      await window.keyboard.up(modifier)
      await expect
        .poll(() => readExternalLinks(electronApp))
        .toEqual([uri, uri, uri, replacementUri])
    } finally {
      await electronApp.close()
    }
  })

  test('modifier link navigation does not also send a mouse gesture to a child TUI', async () => {
    const { electronApp, window } = await launchApp()
    const nodeId = 'node-terminal-link-tui'
    const uri = 'https://example.com/tui'
    try {
      await captureExternalLinks(electronApp)
      await clearAndSeedWorkspace(window, [
        {
          id: nodeId,
          title: 'terminal-link-tui',
          position: { x: 120, y: 100 },
          width: 620,
          height: 340,
        },
      ])
      await printTerminalLinkFixture(window, nodeId, uri, { mouseTracking: true })
      const point = await terminalLinkCellPoint(window, nodeId, 9, 1)
      await window.keyboard.down(modifier)
      await window.mouse.click(point.x, point.y)
      await window.keyboard.up(modifier)
      await expect.poll(() => readExternalLinks(electronApp)).toEqual([uri])
      await window.waitForTimeout(300)
      const receivedMouseInput = () =>
        window.evaluate(
          id =>
            window.__opencoveTerminalSelectionTestApi?.getBufferText(id, 'PTY_MOUSE_INPUT')
              ?.markerAbsoluteLine ?? null,
          nodeId,
        )
      expect(await receivedMouseInput()).toBeNull()
      const emptyCell = await terminalLinkCellPoint(window, nodeId, 20, 3)
      await window.mouse.click(emptyCell.x, emptyCell.y)
      await expect.poll(receivedMouseInput).not.toBeNull()
      await expect(window.locator(actionsSelector)).toBeHidden()
      expect(await readExternalLinks(electronApp)).toEqual([uri])
    } finally {
      await electronApp.close()
    }
  })
})
