import { expect, test } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seededWorkspaceId,
} from './workspace-canvas.helpers'
import { pluginCli, pluginCliFailure, savedCommandNodes } from './plugins.commands.helpers'
import { clickPluginControl } from './plugins.local.helpers'

test('uses explicit project host capabilities from a real CLI plugin backend and window SDK', async () => {
  test.setTimeout(90_000)
  const source = await mkdtemp(join(tmpdir(), 'opencove-target-plugin-'))
  const userDataDir = await createTestUserDataDir()
  const id = 'target-workflow'
  const command = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
  const args =
    process.platform === 'win32'
      ? ['/d', '/c', 'echo target-workflow-complete']
      : ['-c', 'printf target-workflow-complete']
  await writeFile(
    join(source, 'opencove.plugin.json'),
    JSON.stringify({
      apiVersion: 1,
      id,
      version: '1.0.0',
      displayName: 'Target workflow',
      description: 'Real host workflow fixture',
      main: 'main.mjs',
      view: { entry: 'index.html' },
      preview: 'index.html',
      contributes: {
        actionBar: true,
        commands: [
          {
            id: 'inspect',
            title: 'Inspect target',
            description: 'Read and run on a target.',
            target: 'plugin',
          },
        ],
      },
    }),
  )
  const shared = `async function workflow(host, target) {
    const catalog = await host.target.list();
    const resolved = await host.target.resolve(target);
    const files = await host.filesystem.readDirectory({ target });
    const file = await host.filesystem.readText({ target, path: 'package.json' });
    let job = await host.operations.start({ target, command: ${JSON.stringify(command)}, args: ${JSON.stringify(args)} });
    while (['starting', 'running', 'cancelling'].includes(job.status)) {
      await new Promise(resolve => setTimeout(resolve, 50));
      job = await host.operations.get({ operationId: job.operationId });
    }
    return { catalog, target: resolved, names: files.entries.map(item => item.name), packageName: JSON.parse(file.content).name, job };
  }`
  await writeFile(
    join(source, 'main.mjs'),
    `${shared}\nexport function activate({ host }) { return { runCommand(_id, params) { return workflow(host, params); } }; }`,
  )
  await writeFile(
    join(source, 'index.html'),
    '<!doctype html><html><head><script src="app.js" defer></script></head><body><button id="run" disabled>Run target workflow</button><pre id="result"></pre></body></html>',
  )
  await writeFile(
    join(source, 'app.js'),
    `${shared}\n(async () => {
    const api = window.opencovePlugin; const context = await api.ready;
    document.querySelector('#run').disabled = false;
    document.querySelector('#run').onclick = async () => {
      try { document.querySelector('#result').textContent = JSON.stringify(await workflow(api.host, { projectId: context.workspaceId || '${seededWorkspaceId}' })); }
      catch (error) { document.querySelector('#result').textContent = error.message; }
    };
  })();`,
  )
  const { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await clearAndSeedWorkspace(page, [], { settings: { language: 'en' } })
    await pluginCli(userDataDir, ['install', source])
    expect(await pluginCliFailure(userDataDir, ['run', id, 'inspect', '--params', '{}'])).toContain(
      'projectId',
    )
    const backend = await pluginCli(userDataDir, [
      'run',
      id,
      'inspect',
      '--params',
      JSON.stringify({ projectId: seededWorkspaceId }),
    ])
    expect(backend).toMatchObject({
      catalog: {
        projects: expect.arrayContaining([expect.objectContaining({ id: seededWorkspaceId })]),
      },
      packageName: 'opencove',
      target: { projectId: seededWorkspaceId, endpointId: 'local' },
      job: {
        status: 'completed',
        exitCode: 0,
        output: expect.stringContaining('target-workflow-complete'),
      },
    })
    expect(await savedCommandNodes(page, id)).toEqual([])
    await page.getByTestId(`workspace-canvas-action-bar-new-plugin:${id}`).click()
    const view = page
      .locator('.workspace-main')
      .getByTestId(`plugin-view-${id}`)
      .frameLocator('iframe')
    await expect(view.locator('#run')).toBeEnabled()
    await clickPluginControl(view.locator('#run'))
    await expect(view.locator('#result')).toContainText('target-workflow-complete')
    const result = JSON.parse((await view.locator('#result').textContent()) ?? '{}')
    expect(result.job).toMatchObject({ status: 'completed', exitCode: 0 })
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId(`settings-plugin-details-${id}`).click()
    await page.getByTestId('plugin-runtime-preview-toggle').click()
    const preview = page.getByTestId('plugin-node-preview').frameLocator('iframe')
    await expect(preview.locator('#run')).toBeEnabled()
    await clickPluginControl(preview.locator('#run'))
    await expect(preview.locator('#result')).toContainText('Preview cannot access')
  } finally {
    await electronApp.close()
    await removePathWithRetry(source)
    await removePathWithRetry(userDataDir)
  }
})
