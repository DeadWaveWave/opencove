import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import {
  clearTerminalLinkSelection,
  printTerminalLinkFixture,
  terminalLinkCellPoint,
} from '../e2e/workspace-canvas.terminal-links.helpers'
import {
  buildAppState,
  createWorkspaceDir,
  openAuthedCanvas,
  readTextFile,
  writeAppState,
  writeTextFile,
} from './helpers'

async function openTerminal(page: Page, workspacePath: string): Promise<string> {
  await writeAppState(
    page.request,
    buildAppState({
      workspacePath,
      spaces: [],
      settings: { language: 'en', canvasInputMode: 'mouse' },
    }),
  )
  await openAuthedCanvas(page, '/?opencoveTerminalTestApi=1')
  await page
    .locator('.workspace-canvas .react-flow__pane')
    .click({ button: 'right', position: { x: 260, y: 220 } })
  await page.locator('[data-testid="workspace-context-new-terminal"]').click()
  const terminal = page.locator('.react-flow__node').filter({ has: page.locator('.terminal-node') })
  await expect(terminal).toBeVisible()
  const nodeId = await terminal.getAttribute('data-id')
  if (!nodeId) {
    throw new Error('Missing Web terminal node id')
  }
  return nodeId
}

test('Web terminal links open the complete URL from the menu and modifier gesture', async ({
  page,
  context,
}) => {
  const nodeId = await openTerminal(page, await createWorkspaceDir('web-terminal-url'))
  const url = 'https://terminal-link.example/docs/section?q=one%20two#result'
  await context.route('https://terminal-link.example/**', route =>
    route.fulfill({ contentType: 'text/html', body: '<title>Terminal link target</title>' }),
  )
  await printTerminalLinkFixture(page, nodeId, `${url}\r\n`)
  const point = await terminalLinkCellPoint(page, nodeId, 3, 1)
  await page.mouse.click(point.x, point.y)
  const actions = page.locator('[data-testid="terminal-link-actions"][role="dialog"]')
  await expect(actions).toBeVisible()
  expect(context.pages()).toHaveLength(1)
  const menuPopup = context.waitForEvent('page')
  await actions.getByRole('button', { name: 'Open in browser', exact: true }).click()
  const firstTarget = await menuPopup
  await expect(firstTarget).toHaveURL(url)
  await expect(firstTarget).toHaveTitle('Terminal link target')
  await firstTarget.close()

  await clearTerminalLinkSelection(page, nodeId)
  const directPopup = context.waitForEvent('page')
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control')
  await page.mouse.click(point.x, point.y)
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control')
  const secondTarget = await directPopup
  await expect(secondTarget).toHaveURL(url)
  await expect(secondTarget).toHaveTitle('Terminal link target')
  await secondTarget.close()
})

test('Web terminal file links resolve asynchronously and navigate the document to line and column', async ({
  page,
}) => {
  const workspacePath = await createWorkspaceDir('web-terminal-document')
  const filePath = path.join(workspacePath, 'navigation.txt')
  await writeTextFile(
    filePath,
    Array.from({ length: 30 }, (_, index) => `line-${index + 1}-content`).join('\n'),
  )
  const nodeId = await openTerminal(page, workspacePath)
  await printTerminalLinkFixture(page, nodeId, `${filePath}:12:4\r\n`)
  const point = await terminalLinkCellPoint(page, nodeId, 3, 1)
  await page.mouse.click(point.x, point.y)
  const actions = page.locator('[data-testid="terminal-link-actions"][role="dialog"]')
  await expect(actions).toBeVisible()
  const openFile = actions.getByRole('button', { name: 'Open file', exact: true })
  await expect(openFile).toBeEnabled()
  await expect(
    actions.getByRole('button', { name: 'Open with default app', exact: true }),
  ).toHaveCount(0)
  await openFile.click()
  const document = page.locator('.document-node')
  await expect(document).toHaveCount(1)
  await expect(document.locator('.inputarea, .native-edit-context')).toBeFocused()
  await page.keyboard.type('WEB_LINK_INSERT_')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
  await expect
    .poll(async () => (await readTextFile(filePath)).split('\n')[11])
    .toBe('linWEB_LINK_INSERT_e-12-content')
})
