import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  openPaneContextMenuAtFlowPoint,
  readSeededWorkspaceLayout,
} from './workspace-canvas.arrange.shared'

const nodeIds: [string, string] = ['preference-note-a', 'preference-note-b']

async function openArrangeMenu(window: Page): Promise<void> {
  const pane = window.locator('.workspace-canvas .react-flow__pane')
  await expect(pane).toBeVisible()
  await openPaneContextMenuAtFlowPoint(window, pane, { x: 20, y: 20 })
  await window.locator('[data-testid="workspace-context-arrange-by"]').click()
  await expect(window.locator('[data-testid="workspace-context-arrange-by-menu"]')).toBeVisible()
}

async function quitApp(electronApp: ElectronApplication): Promise<void> {
  const closed = electronApp.waitForEvent('close', { timeout: 15_000 }).catch(() => undefined)
  await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await closed
}

test('restores sidebar and arrange preferences after a cold restart', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDir = await createTestUserDataDir()
  let electronApp: ElectronApplication | null = null
  let window: Page | null = null

  try {
    ;({ electronApp, window } = await launchApp({
      userDataDir,
      cleanupUserDataDir: false,
    }))
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: nodeIds[0],
          title: 'Preference note A',
          position: { x: 300, y: 160 },
          width: 340,
          height: 210,
          kind: 'note',
          task: { text: 'Keep this custom size' },
        },
        {
          id: nodeIds[1],
          title: 'Preference note B',
          position: { x: 760, y: 180 },
          width: 420,
          height: 260,
          kind: 'note',
          task: { text: 'Keep this different custom size' },
        },
      ],
      {
        spaces: [
          {
            id: 'preference-space',
            name: 'Preference Space',
            directoryPath: testWorkspacePath,
            nodeIds: [nodeIds[0]],
            rect: { x: 260, y: 120, width: 420, height: 300 },
          },
        ],
      },
    )

    await window.locator('[data-testid="workspace-sidebar-pin"]').click()
    await expect(window.locator('.app-shell--sidebar-collapsed')).toHaveCount(1)

    await openArrangeMenu(window)
    const preserveWindowSizes = window.locator(
      '[data-testid="workspace-context-arrange-preserve-window-sizes"]',
    )
    await expect(preserveWindowSizes.locator('svg')).toHaveCount(0)
    await preserveWindowSizes.click()
    await expect(preserveWindowSizes.locator('svg')).toHaveCount(1)

    await quitApp(electronApp)
    electronApp = null
    window = null
    ;({ electronApp, window } = await launchApp({
      userDataDir,
      cleanupUserDataDir: false,
    }))

    await expect(window.locator('.app-shell--sidebar-collapsed')).toHaveCount(1)
    await openArrangeMenu(window)
    await expect(
      window
        .locator('[data-testid="workspace-context-arrange-preserve-window-sizes"]')
        .locator('svg'),
    ).toHaveCount(1)

    await window.keyboard.press('Escape')
    await window.locator('.react-flow__controls-fitview').click()
    const spaceMenu = window.locator('[data-testid="workspace-space-menu-preference-space"]')
    await expect(spaceMenu).toBeInViewport()
    await spaceMenu.click()
    await expect(
      window.locator('[data-testid="workspace-space-action-preserve-window-sizes"] svg'),
    ).toHaveCount(1)

    await testInfo.attach('restored-ui-preferences', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })

    await window.keyboard.press('Escape')
    await openArrangeMenu(window)

    const beforeArrange = await readSeededWorkspaceLayout(window, { nodeIds, spaceIds: [] })
    await window.locator('[data-testid="workspace-context-arrange"]').click()
    await expect
      .poll(async () => {
        const afterArrange = await readSeededWorkspaceLayout(window!, { nodeIds, spaceIds: [] })
        return Object.fromEntries(
          nodeIds.map(nodeId => [
            nodeId,
            {
              width: afterArrange.nodes[nodeId]?.width,
              height: afterArrange.nodes[nodeId]?.height,
            },
          ]),
        )
      })
      .toEqual(
        Object.fromEntries(
          nodeIds.map(nodeId => [
            nodeId,
            {
              width: beforeArrange.nodes[nodeId]?.width,
              height: beforeArrange.nodes[nodeId]?.height,
            },
          ]),
        ),
      )
  } finally {
    await electronApp?.close().catch(() => undefined)
    await removePathWithRetry(userDataDir)
  }
})
