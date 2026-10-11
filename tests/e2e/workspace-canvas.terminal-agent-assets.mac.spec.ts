import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
} from './workspace-canvas.helpers'

async function assertInput(window: Page, terminal: Locator, suffix: string) {
  await expect(terminal.locator('.terminal-node__terminal')).toHaveAttribute('aria-busy', 'false')
  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  // The expected result never appears as a contiguous string in the echoed input.
  await window.keyboard.type(`printf 'ASSETS_%s\\n' '${suffix}'`)
  await window.keyboard.press('Enter')
  await expect(terminal).toContainText(`ASSETS_${suffix}`)
  await expect(terminal).not.toContainText('[process exited with code')
}

test('repairs lost launch assets before creating the next interactive terminal', async () => {
  test.skip(process.platform !== 'darwin', 'macOS long-lived shell launch regression')
  const userDataDir = await createTestUserDataDir()
  const workspace = join(userDataDir, 'workspace')
  await mkdir(workspace)
  const { electronApp, window } = await launchApp({
    userDataDir,
    cleanupUserDataDir: false,
    env: { SHELL: '/bin/zsh', OPENCOVE_TEST_WORKSPACE: workspace },
  })
  const pageErrors: string[] = []
  window.on('pageerror', error => pageErrors.push(error.message))
  try {
    await seedWorkspaceState(window, {
      activeWorkspaceId: 'assets-test',
      workspaces: [
        {
          id: 'assets-test',
          name: 'assets-test',
          path: workspace,
          activeSpaceId: null,
          spaces: [],
          nodes: [
            {
              id: 'old-terminal',
              title: 'Original shell',
              kind: 'terminal',
              position: { x: 50, y: 100 },
              width: 520,
              height: 320,
              executionDirectory: workspace,
            },
          ],
        },
      ],
    })
    await assertInput(window, window.locator('[data-id="old-terminal"] .terminal-node'), 'BEFORE')
    const parent = join(userDataDir, 'runtime', 'terminal-agent')
    const instances = (await readdir(parent)).filter(name => name.startsWith('instance-'))
    expect(instances).toHaveLength(1)
    const root = join(parent, instances[0]!)
    const launcher = await readFile(join(root, 'shell-launcher.sh'), 'utf8')
    await rm(root, { recursive: true })
    await window
      .locator('.workspace-canvas .react-flow__pane')
      .click({ button: 'right', position: { x: 780, y: 160 } })
    await window.getByTestId('workspace-context-new-terminal').click()
    await expect(window.locator('.terminal-node')).toHaveCount(2)
    await window.locator('.react-flow__controls-fitview').click()
    const next = window.locator('.react-flow__node:not([data-id="old-terminal"]) .terminal-node')
    await assertInput(window, next, 'AFTER_REPAIR')
    expect(await readFile(join(root, 'shell-launcher.sh'), 'utf8')).toBe(launcher)
    expect((await readdir(parent)).filter(name => name.startsWith('instance-'))).toEqual(instances)
    const diagnostics = await readFile(join(userDataDir, 'logs', 'runtime-diagnostics.log'), 'utf8')
    expect(diagnostics).toContain('assets-repaired')
    expect(pageErrors).toEqual([])
    await test.info().attach('terminal-after-asset-repair', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    await electronApp.close()
    await removePathWithRetry(userDataDir)
  }
})
