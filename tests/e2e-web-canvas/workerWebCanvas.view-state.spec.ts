import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  openAuthedCanvas,
  readSharedState,
  readViewState,
  webCanvasBaseUrl,
  writeAppState,
} from './helpers'

test.describe('Worker web canvas view state', () => {
  test('keeps space selection local per client and hides desktop-only path openers', async ({
    browser,
    page,
  }) => {
    const workspacePath = await createWorkspaceDir('view-state')
    const workspaceId = 'workspace-1'
    const state = buildAppState({
      workspacePath,
      workspaceId,
      spaces: [
        {
          id: 'space-a',
          name: 'Alpha',
          directoryPath: workspacePath,
          nodeIds: ['anchor-a'],
          rect: { x: 0, y: 0, width: 720, height: 520 },
        },
        {
          id: 'space-b',
          name: 'Beta',
          directoryPath: workspacePath,
          nodeIds: ['anchor-b'],
          rect: { x: 820, y: 0, width: 720, height: 520 },
        },
      ],
      nodes: [
        {
          id: 'anchor-a',
          title: 'note',
          kind: 'note',
          position: { x: 120, y: 120 },
          width: 240,
          height: 180,
          text: 'alpha anchor',
        },
        {
          id: 'anchor-b',
          title: 'note',
          kind: 'note',
          position: { x: 960, y: 120 },
          width: 240,
          height: 180,
          text: 'beta anchor',
        },
      ],
    })
    await writeAppState(page.request, state)

    await openAuthedCanvas(page)
    const secondContext = await browser.newContext({ baseURL: webCanvasBaseUrl })
    const secondPage = await secondContext.newPage()

    try {
      await openAuthedCanvas(secondPage)

      await page.locator('[data-testid="workspace-space-switch-space-b"]').evaluate(button => {
        ;(button as HTMLButtonElement).click()
      })

      await expect
        .poll(async () => {
          const viewState = (await readViewState(page)) as {
            workspaces?: Record<string, { activeSpaceId?: string | null }>
          } | null
          return viewState?.workspaces?.[workspaceId]?.activeSpaceId ?? null
        })
        .toBe('space-b')

      await expect
        .poll(async () => {
          const viewState = (await readViewState(secondPage)) as {
            workspaces?: Record<string, { activeSpaceId?: string | null }>
          } | null
          return viewState?.workspaces?.[workspaceId]?.activeSpaceId ?? null
        })
        .toBe('space-a')

      const shared = await readSharedState(page.request)
      expect(shared.state?.workspaces[0]?.activeSpaceId).toBe('space-a')

      await page.locator('[data-testid="workspace-space-menu-space-b"]').click({ force: true })
      await expect(page.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
      await expect(page.locator('[data-testid="workspace-space-action-open"]')).toHaveCount(0)
    } finally {
      await secondContext.close()
    }
  })
})
