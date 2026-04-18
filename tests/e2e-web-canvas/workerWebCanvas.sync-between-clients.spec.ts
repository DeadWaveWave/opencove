import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  fileUri,
  openAuthedCanvas,
  readSharedState,
  webCanvasBaseUrl,
  writeAppState,
  writeTextFile,
} from './helpers'

test.describe('Worker web canvas sync between clients', () => {
  test('syncs note text edits across web clients', async ({ browser, page }) => {
    const workspacePath = await createWorkspaceDir('note-edit-sync')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 120, y: 120 },
            width: 360,
            height: 240,
            text: 'initial',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const secondContext = await browser.newContext({ baseURL: webCanvasBaseUrl })
    const secondPage = await secondContext.newPage()

    try {
      await openAuthedCanvas(secondPage)

      const primaryTextarea = page.locator('[data-testid="note-node-textarea"]').first()
      const secondaryTextarea = secondPage.locator('[data-testid="note-node-textarea"]').first()

      await expect(primaryTextarea).toBeVisible()
      await expect(secondaryTextarea).toBeVisible()
      await expect(secondaryTextarea).toHaveValue('initial')

      const updatedText = `updated-from-client-${Date.now()}`
      await primaryTextarea.fill(updatedText)
      await expect(primaryTextarea).toHaveValue(updatedText)

      await expect.poll(async () => await secondaryTextarea.inputValue()).toBe(updatedText)
    } finally {
      await secondContext.close()
    }
  })

  test('syncs node closes across web clients', async ({ browser, page }) => {
    const workspacePath = await createWorkspaceDir('node-close-sync')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 40, y: 40 },
            width: 240,
            height: 180,
            text: 'anchor',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const secondContext = await browser.newContext({ baseURL: webCanvasBaseUrl })
    const secondPage = await secondContext.newPage()

    try {
      await openAuthedCanvas(secondPage)

      const pane = page.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await pane.click({ button: 'right', position: { x: 560, y: 420 } })
      await page.locator('[data-testid="workspace-context-new-terminal"]').click()

      const primaryTerminal = page.locator('.terminal-node').first()
      await expect(primaryTerminal).toBeVisible()

      const secondaryTerminal = secondPage.locator('.terminal-node').first()
      await expect(secondaryTerminal).toBeVisible()

      const beforeCloseState = await readSharedState(page.request)
      const beforeCloseRevision = beforeCloseState.revision

      await primaryTerminal.locator('.terminal-node__close').click()
      await expect(page.locator('.terminal-node')).toHaveCount(0)

      await expect
        .poll(async () => (await readSharedState(page.request)).revision)
        .toBeGreaterThan(beforeCloseRevision)

      await expect
        .poll(async () => {
          const shared = await readSharedState(page.request)
          const nodes = shared.state?.workspaces[0]?.nodes ?? []
          return nodes.some(node => node.kind === 'terminal')
        })
        .toBe(false)

      await expect.poll(async () => await secondPage.locator('.terminal-node').count()).toBe(0)
    } finally {
      await secondContext.close()
    }
  })

  test('syncs document node closes across web clients', async ({ browser, page }) => {
    const workspacePath = await createWorkspaceDir('document-close-sync')
    const documentPath = `${workspacePath}/readme.md`
    await writeTextFile(documentPath, '# doc\n')

    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1', 'doc-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 40, y: 40 },
            width: 240,
            height: 180,
            text: 'anchor',
          },
          {
            id: 'doc-1',
            title: 'readme.md',
            kind: 'document',
            position: { x: 120, y: 120 },
            width: 420,
            height: 320,
            uri: fileUri(documentPath),
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const secondContext = await browser.newContext({ baseURL: webCanvasBaseUrl })
    const secondPage = await secondContext.newPage()

    try {
      await openAuthedCanvas(secondPage)

      const primaryDoc = page.locator('.document-node').first()
      const secondaryDoc = secondPage.locator('.document-node').first()

      await expect(primaryDoc).toBeVisible()
      await expect(secondaryDoc).toBeVisible()
      await expect(primaryDoc.locator('[data-testid="document-node-textarea"]')).toBeVisible()
      await expect(secondaryDoc.locator('[data-testid="document-node-textarea"]')).toBeVisible()

      const beforeCloseState = await readSharedState(page.request)
      const beforeCloseRevision = beforeCloseState.revision

      await primaryDoc.locator('.document-node__close').click()
      await expect(page.locator('.document-node')).toHaveCount(0)

      await expect
        .poll(async () => (await readSharedState(page.request)).revision)
        .toBeGreaterThan(beforeCloseRevision)

      await expect
        .poll(async () => {
          const shared = await readSharedState(page.request)
          const nodes = shared.state?.workspaces[0]?.nodes ?? []
          return nodes.some(node => node.kind === 'document')
        })
        .toBe(false)

      await expect.poll(async () => await secondPage.locator('.document-node').count()).toBe(0)
    } finally {
      await secondContext.close()
    }
  })
})
