import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seededWorkspaceId,
} from './workspace-canvas.helpers'
import { capturePlugins } from './plugins.local.helpers'
import {
  canvasPluginNode,
  createCommandPlugin,
  expectCommandReady,
  pluginCli,
  type PluginWindowResult,
} from './plugins.commands.helpers'

interface TitleList {
  windows: Array<{
    nodeId: string
    title: string
    savedTitle: string
    views: Array<{ viewId: string; title: string; contentTitle?: string }>
  }>
}

test('reports acknowledged SDK titles to CLI while preserving the saved window name across reload', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(90_000)
  const source = await createCommandPlugin('single')
  await writeFile(
    join(source.directory, 'view.js'),
    `const api = window.opencovePlugin;
    api.ready.then(async context => {
      const output = document.querySelector('#label');
      const key = 'title-' + context.nodeId;
      const initial = (await api.storage.get(key)) ?? 'Initial content';
      await api.setTitle(initial);
      output.textContent = initial;
      api.onCommand(async (commandId, params) => {
        if (commandId !== 'set-label' || typeof params?.label !== 'string') throw new Error('Invalid title');
        await api.storage.set(key, params.label);
        await api.setTitle(params.label);
        output.textContent = params.label;
        return { title: params.label };
      });
      document.querySelector('#ready').textContent = 'Ready';
    }).catch(error => { document.querySelector('#ready').textContent = error.message; });`,
  )
  const userDataDir = await createTestUserDataDir()
  const { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await page.setViewportSize({ width: 1400, height: 950 })
    await clearAndSeedWorkspace(page, [], {
      settings: {
        language: 'en',
        uiTheme: 'pixel',
        focusNodeOnClick: false,
        canvasInputMode: 'mouse',
        nodeCreationPixelEffectEnabled: false,
        nodeClosePixelEffectEnabled: false,
      },
    })
    await pluginCli(userDataDir, ['install', source.directory])
    const opened = await pluginCli<PluginWindowResult>(userDataDir, [
      'open',
      source.id,
      '--project',
      seededWorkspaceId,
    ])
    const node = canvasPluginNode(page, opened.nodeId)
    await expectCommandReady(node)
    await pluginCli(userDataDir, [
      'run',
      source.id,
      'set-label',
      '--node',
      opened.nodeId,
      '--params',
      JSON.stringify({ label: 'Planning card' }),
    ])
    const current = await pluginCli<TitleList>(userDataDir, ['windows', source.id])
    expect(current.windows[0]).toMatchObject({
      nodeId: opened.nodeId,
      title: 'Planning card',
      savedTitle: 'Command fixture',
      views: [{ title: 'Planning card', contentTitle: 'Planning card' }],
    })
    await expect(node.locator('.cove-canvas-node-window__title')).toHaveText('Planning card')
    const beforeReload = await node.locator('iframe').getAttribute('src')
    await pluginCli(userDataDir, ['reload', source.id])
    await expect(node.locator('iframe')).not.toHaveAttribute('src', beforeReload!)
    await expectCommandReady(node)
    const restored = await pluginCli<TitleList>(userDataDir, ['windows', source.id])
    expect(restored.windows[0]).toMatchObject({
      title: 'Planning card',
      savedTitle: 'Command fixture',
    })
    expect(restored.windows[0].views[0].viewId).not.toBe(current.windows[0].views[0].viewId)
    await expect(node.locator('.cove-canvas-node-window__title')).toHaveText('Planning card')
    await capturePlugins(page, info, 'plugin-content-title-cli-agreement')
    await writeFile(
      join(source.directory, 'view.js'),
      `window.opencovePlugin.ready.then(() => {
      document.querySelector('#label').textContent = 'No custom title';
      document.querySelector('#ready').textContent = 'Ready';
    });`,
    )
    const titledSource = await node.locator('iframe').getAttribute('src')
    await pluginCli(userDataDir, ['reload', source.id])
    await expect(node.locator('iframe')).not.toHaveAttribute('src', titledSource!)
    await expect(node.frameLocator('iframe').locator('#label')).toHaveText('No custom title')
    await expect(node.locator('.cove-canvas-node-window__title')).toHaveText('Command fixture')
    const withoutTitle = await pluginCli<TitleList>(userDataDir, ['windows', source.id])
    expect(withoutTitle.windows[0]).toMatchObject({
      title: 'Command fixture',
      savedTitle: 'Command fixture',
    })
    expect(withoutTitle.windows[0].views[0]).not.toHaveProperty('contentTitle')
  } finally {
    await electronApp.close()
    await removePathWithRetry(source.directory)
    await removePathWithRetry(userDataDir)
  }
})
