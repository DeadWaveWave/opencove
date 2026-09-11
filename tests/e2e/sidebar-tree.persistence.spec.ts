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
      projects: { 'project-a': true },
      spaces: collapsed
        ? { 'project-a:project-root': true, 'project-a:project-a-space': true }
        : {},
    })
}

async function quitApp(electronApp: ElectronApplication): Promise<void> {
  const appProcess = electronApp.process()
  await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await electronApp.close()
  // The shared close helper bounds Worker cleanup; require actual process exit before reopening.
  await expect.poll(() => appProcess.exitCode !== null || appProcess.signalCode !== null).toBe(true)
}

test('restores root and Space disclosure independently of project navigation after two cold restarts', async ({
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
      settings: {
        standardWindowSizeBucket: 'regular',
        sidebarCollapsedWorkspaceIds: { 'project-a': true },
      },
      workspaces: ['project-a', 'project-b'].map(id => ({
        id,
        name: id,
        path: testWorkspacePath,
        nodes: ['root', 'space'].map((group, index) => ({
          ...createRailAgent(
            `${id}-${group}-agent`,
            `${id} ${group} agent`,
            400 * index,
            'Test',
            '2026-01-01T00:00:00.000Z',
          ),
          status: 'stopped' as const,
        })),
        spaces: [
          {
            id: `${id}-space`,
            name: 'Shared Space',
            directoryPath: testWorkspacePath,
            nodeIds: [`${id}-space-agent`],
            rect: null,
          },
        ],
      })),
    })
    const toggle = (id: string, group: 'root' | 'space') =>
      window.getByTestId(
        `workspace-space-toggle-${id}-${group === 'root' ? 'project-root' : `${id}-space`}`,
      )
    const expectGroups = async (id: string, expanded: boolean): Promise<void> => {
      await Promise.all(
        (['root', 'space'] as const).flatMap(group => [
          expect(toggle(id, group)).toHaveAttribute('aria-expanded', String(expanded)),
          expect(window.getByTestId(`workspace-agent-item-${id}-${id}-${group}-agent`)).toHaveCount(
            expanded ? 1 : 0,
          ),
        ]),
      )
    }
    const selectProject = async (id: string): Promise<void> => {
      await window.getByTestId(`workspace-item-${id}`).click()
      await expect(window.getByTestId(`workspace-item-${id}`)).toHaveAttribute(
        'aria-current',
        'page',
      )
    }
    await expectGroups('project-a', true)
    await toggle('project-a', 'root').click()
    await toggle('project-a', 'space').click()
    await expectGroups('project-a', false)
    await selectProject('project-b')
    await expectGroups('project-b', true)
    await selectProject('project-a')
    await expectGroups('project-a', false)

    await expectPersistedDisclosure(window, true)
    await quitApp(app)
    app = null
    launched = await launchApp({ userDataDir, cleanupUserDataDir: false })
    app = launched.electronApp
    window = launched.window
    await expectGroups('project-a', false)
    await selectProject('project-b')
    await expectGroups('project-b', true)
    await selectProject('project-a')
    await expectGroups('project-a', false)
    await testInfo.attach('restored-root-and-space-disclosure', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    await toggle('project-a', 'root').click()
    await toggle('project-a', 'space').click()
    await expectGroups('project-a', true)

    await expectPersistedDisclosure(window, false)
    await quitApp(app)
    app = null
    launched = await launchApp({ userDataDir, cleanupUserDataDir: false })
    app = launched.electronApp
    window = launched.window
    await expectGroups('project-a', true)
    await selectProject('project-b')
    await expectGroups('project-b', true)
    await expectPersistedDisclosure(window, false)
  } finally {
    await app?.close().catch(() => undefined)
    await removePathWithRetry(userDataDir)
  }
})
