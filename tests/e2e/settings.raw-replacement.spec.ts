import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

test('keeps an imported theme when the outgoing renderer publishes a queued edit', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp()
  const reload = window.reload.bind(window)
  const workspace = {
    id: 'theme-replacement',
    name: 'Theme replacement',
    path: testWorkspacePath,
    nodes: [],
    spaces: [{ id: 'space', name: 'Original', directoryPath: testWorkspacePath, nodeIds: [] }],
    activeSpaceId: 'space',
  }
  const seed = (uiTheme: string) =>
    seedWorkspaceState(window, {
      activeWorkspaceId: workspace.id,
      workspaces: [workspace],
      settings: { uiTheme, standardWindowSizeBucket: 'regular' },
    })
  const read = () =>
    window.evaluate(async () =>
      JSON.parse((await window.opencoveApi.persistence.readWorkspaceStateRaw())!),
    )

  try {
    await window.clock.install()
    await seed('dark')
    await expect(window.locator('html')).toHaveAttribute('data-cove-theme', 'dark')
    await window.clock.pauseAt(await window.evaluate(() => Date.now() + 1000))

    // Hold the real renderer's debounced save, then release it after the raw seed commits.
    await window
      .getByTestId(`workspace-space-item-${workspace.id}-space`)
      .dispatchEvent('contextmenu')
    const field = window.locator('.workspace-project-context-menu__space-editor input')
    await field.fill('Local rename')
    await field.press('Enter')
    await expect(window.getByTestId(`workspace-space-item-${workspace.id}-space`)).toContainText(
      'Local rename',
    )
    window.reload = async options => {
      const seeded = await read()
      expect(seeded.settings.uiTheme).toBe('light')
      await window.clock.runFor(250)
      await expect
        .poll(async () => (await read()).workspaces[0].spaces[0].name)
        .toBe('Local rename')
      await testInfo.attach('raw-replacement-and-outgoing-save', {
        body: JSON.stringify({ seeded, afterOutgoingSave: await read() }),
        contentType: 'application/json',
      })
      await window.clock.resume()
      return reload(options)
    }

    await seed('light')
    window.reload = reload
    await expect(window.locator('html')).toHaveAttribute('data-cove-theme', 'light')
    expect((await read()).settings.uiTheme).toBe('light')
  } finally {
    window.reload = reload
    await electronApp.close()
  }
})
