import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  openAuthedCanvas,
  readSharedState,
  writeAppState,
} from './helpers'

test.describe('Worker web canvas note titles', () => {
  test('edits note titles inline and persists empty titles as untitled notes', async ({
    page,
  }, testInfo) => {
    const workspacePath = await createWorkspaceDir('note-title-edit')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-title'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-title',
            title: 'note',
            kind: 'note',
            position: { x: 160, y: 140 },
            width: 320,
            height: 220,
            text: 'body',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const titleDisplay = page.locator('[data-testid="note-node-title-display"]').first()
    await expect(titleDisplay).toHaveText('note')

    await titleDisplay.click()
    let titleInput = page.locator('[data-testid="note-node-title-input"]').first()
    await expect(titleInput).toHaveValue('note')

    await titleInput.fill('Renamed note')
    await titleInput.press('Enter')
    await expect(titleDisplay).toHaveText('Renamed note')

    await expect
      .poll(async () => {
        const shared = await readSharedState(page.request)
        const note = shared.state?.workspaces[0]?.nodes.find(node => node.id === 'note-title')
        return note?.title
      })
      .toBe('Renamed note')

    await titleDisplay.click()
    titleInput = page.locator('[data-testid="note-node-title-input"]').first()
    await expect(titleInput).toHaveValue('Renamed note')
    await titleInput.fill('')
    await titleInput.press('Enter')
    await expect(titleDisplay).toHaveText('Untitled note')

    await expect
      .poll(async () => {
        const shared = await readSharedState(page.request)
        const note = shared.state?.workspaces[0]?.nodes.find(node => node.id === 'note-title')
        return note?.title
      })
      .toBe('')

    await testInfo.attach('note-title-inline-edit', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
