import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

async function expectPersistedDisclosure(window: Page, collapsed: boolean): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await window.evaluate(() =>
        window.opencoveApi.persistence.readWorkspaceStateRaw(),
      )
      const state = raw ? JSON.parse(raw) : null
      return {
        projects: state?.settings?.sidebarCollapsedWorkspaceIds,
        spaces: state?.settings?.sidebarCollapsedSpaceGroupIds,
      }
    })
    .toEqual({
      projects: collapsed ? { 'project-a': true } : {},
      spaces: collapsed ? { 'project-a:space-0': true } : {},
    })
}

async function quitApp(electronApp: ElectronApplication): Promise<void> {
  const appProcess = electronApp.process()
  await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await electronApp.close()
  // The shared close helper bounds Worker cleanup; require actual process exit before reopening.
  await expect.poll(() => appProcess.exitCode !== null || appProcess.signalCode !== null).toBe(true)
}

test('restores project and Space group disclosure after two cold restarts', async ({
  browserName: _,
}, testInfo) => {
  const userDataDir = await createTestUserDataDir()
  let app: ElectronApplication | null = null
  try {
    let launched = await launchApp({ userDataDir, cleanupUserDataDir: false })
    app = launched.electronApp
    let window = launched.window
    await seedWorkspaceState(window, {
      activeWorkspaceId: 'project-a',
      settings: { standardWindowSizeBucket: 'regular' },
      workspaces: ['project-a', 'project-b'].map((id, index) => ({
        id,
        name: id,
        path: testWorkspacePath,
        nodes: [
          {
            ...createRailAgent(
              `${id}-agent`,
              `${id} agent`,
              400,
              'Test',
              '2026-01-01T00:00:00.000Z',
            ),
            status: 'stopped' as const,
          },
        ],
        spaces: [
          {
            id: `space-${index}`,
            name: `Space ${index}`,
            directoryPath: testWorkspacePath,
            nodeIds: [`${id}-agent`],
            rect: null,
          },
        ],
      })),
    })
    const projectToggle = (id: string) => window.getByTestId(`workspace-item-toggle-${id}`)
    const spaceToggle = () =>
      window.getByTestId('workspace-space-item-project-a-space-0').locator('button[aria-expanded]')
    await expect(spaceToggle()).toHaveAttribute('aria-expanded', 'true')
    await spaceToggle().click()
    await expect(spaceToggle()).toHaveAttribute('aria-expanded', 'false')
    await projectToggle('project-a').click()
    await expect(projectToggle('project-a')).toHaveAttribute('aria-expanded', 'false')
    await expect(projectToggle('project-b')).toHaveAttribute('aria-expanded', 'true')

    await expectPersistedDisclosure(window, true)
    await quitApp(app)
    app = null
    launched = await launchApp({ userDataDir, cleanupUserDataDir: false })
    app = launched.electronApp
    window = launched.window
    await expect(projectToggle('project-a')).toHaveAttribute('aria-expanded', 'false')
    await expect(projectToggle('project-b')).toHaveAttribute('aria-expanded', 'true')
    await projectToggle('project-a').click()
    await expect(spaceToggle()).toHaveAttribute('aria-expanded', 'false')
    await expect(window.getByTestId('workspace-agent-item-project-a-project-a-agent')).toHaveCount(
      0,
    )
    await testInfo.attach('restored-project-and-space-disclosure', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    await spaceToggle().click()
    await expect(spaceToggle()).toHaveAttribute('aria-expanded', 'true')

    await expectPersistedDisclosure(window, false)
    await quitApp(app)
    app = null
    launched = await launchApp({ userDataDir, cleanupUserDataDir: false })
    app = launched.electronApp
    window = launched.window
    await expect(projectToggle('project-a')).toHaveAttribute('aria-expanded', 'true')
    await expect(spaceToggle()).toHaveAttribute('aria-expanded', 'true')
  } finally {
    await app?.close().catch(() => undefined)
    await removePathWithRetry(userDataDir)
  }
})
