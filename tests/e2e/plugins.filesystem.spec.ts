import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
} from './workspace-canvas.helpers'
import { pluginCli, savedCommandNodes } from './plugins.commands.helpers'
import { clickPluginControl } from './plugins.local.helpers'

interface FileWorkflowResult {
  bytes: number
  sameContent: boolean
  overwriteRejected: boolean
  preservedOriginal: boolean
  recursiveRejected: boolean
  created: Array<{ type: string; path: string }>
  renamed: Array<{ type: string; path: string }>
  deleted: Array<{ type: string; path: string }>
  unwatchRejected: boolean
  emptyAfterDelete: boolean
}

function expectWorkflow(result: FileWorkflowResult, directory: string) {
  expect(result.bytes).toBeGreaterThan(64 * 1024)
  expect(result).toMatchObject({
    sameContent: true,
    overwriteRejected: true,
    preservedOriginal: true,
    recursiveRejected: true,
    unwatchRejected: true,
    emptyAfterDelete: true,
  })
  expect(result.created).toContainEqual({ type: 'created', path: `${directory}/large.txt` })
  expect(result.renamed).toEqual(
    expect.arrayContaining([
      { type: 'deleted', path: `${directory}/large.txt` },
      { type: 'created', path: `${directory}/renamed.txt` },
    ]),
  )
  expect(result.deleted).toContainEqual({ type: 'deleted', path: `${directory}/renamed.txt` })
}

test('uses scoped filesystem mutations and observations through installed backend and window SDKs', async () => {
  test.setTimeout(120_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-plugin-filesystem-e2e-'))
  const source = join(root, 'plugin')
  const project = join(root, 'project')
  const projectId = 'plugin-filesystem-project'
  const id = 'filesystem-workflow'
  const userDataDir = await createTestUserDataDir()
  await Promise.all([mkdir(source), mkdir(project)])
  // The target is exclusively this fixture directory; plugin code never writes into the app repo.
  const workflow = `async function workflow(host, target, directory) {
    const path = directory + '/large.txt';
    const renamedPath = directory + '/renamed.txt';
    const content = 'OpenCove 文件系统 ✨\\n'.repeat(6000);
    await host.filesystem.mkdir({ target, path: directory });
    const watch = await host.filesystem.watch({ target, path: directory });
    await host.filesystem.writeText({ target, path, content, overwrite: false });
    const info = await host.filesystem.stat({ target, path });
    const read = await host.filesystem.readText({ target, path });
    let overwriteRejected = false;
    try { await host.filesystem.writeText({ target, path, content: 'must not replace', overwrite: false }); }
    catch { overwriteRejected = true; }
    const preserved = await host.filesystem.readText({ target, path });
    let recursiveRejected = false;
    try { await host.filesystem.delete({ target, path: directory, recursive: false }); }
    catch { recursiveRejected = true; }
    await new Promise(resolve => setTimeout(resolve, watch.intervalMs + 50));
    const created = await host.filesystem.readWatch({ watchId: watch.watchId });
    await host.filesystem.rename({ target, path, newPath: renamedPath });
    await new Promise(resolve => setTimeout(resolve, created.retryAfterMs + 50));
    const renamed = await host.filesystem.readWatch({ watchId: watch.watchId });
    await host.filesystem.delete({ target, path: renamedPath, recursive: false });
    await new Promise(resolve => setTimeout(resolve, renamed.retryAfterMs + 50));
    const deleted = await host.filesystem.readWatch({ watchId: watch.watchId });
    const listing = await host.filesystem.readDirectory({ target, path: directory });
    await host.filesystem.unwatch({ watchId: watch.watchId });
    let unwatchRejected = false;
    try { await host.filesystem.readWatch({ watchId: watch.watchId }); }
    catch { unwatchRejected = true; }
    await host.filesystem.delete({ target, path: directory, recursive: false });
    return {
      bytes: info.stat.sizeBytes, sameContent: read.content === content,
      overwriteRejected, preservedOriginal: preserved.content === content, recursiveRejected,
      created: created.events, renamed: renamed.events, deleted: deleted.events,
      unwatchRejected, emptyAfterDelete: listing.entries.length === 0,
    };
  }`
  const files = {
    'opencove.plugin.json': JSON.stringify({
      apiVersion: 1,
      id,
      version: '1.0.0',
      displayName: 'Filesystem workflow',
      description: 'Installed scoped filesystem workflow fixture',
      main: 'main.mjs',
      view: { entry: 'index.html', width: 520, height: 340 },
      preview: 'index.html',
      contributes: {
        actionBar: true,
        commands: [
          {
            id: 'verify-files',
            title: 'Verify files',
            description: 'Exercises the host filesystem without opening a window.',
            target: 'plugin',
          },
        ],
      },
    }),
    'main.mjs': `${workflow}
      export function activate({ host }) {
        return { runCommand(_id, params) { return workflow(host, params, 'backend-files'); } };
      }`,
    'index.html': `<!doctype html><html><head><meta charset="utf-8">
      <script src="view.js" defer></script></head><body>
      <button id="run" disabled>Verify filesystem</button><pre id="result"></pre></body></html>`,
    'view.js': `${workflow}
      const api = window.opencovePlugin;
      api.ready.then(context => {
        const button = document.querySelector('#run');
        const result = document.querySelector('#result');
        button.disabled = false;
        button.onclick = async () => {
          button.disabled = true;
          try {
            const target = { projectId: ${JSON.stringify(projectId)} };
            if (context.preview) {
              const requests = {
                read: () => api.host.filesystem.readText({ target, path: 'preview.txt' }),
                write: () => api.host.filesystem.writeText({ target, path: 'preview.txt', content: 'forbidden', overwrite: false }),
                watch: () => api.host.filesystem.watch({ target }),
              };
              const failures = {};
              await Promise.all(Object.entries(requests).map(async ([key, run]) => {
                try { await run(); failures[key] = 'unexpectedly succeeded'; }
                catch (error) { failures[key] = error.message; }
              }));
              result.textContent = JSON.stringify({ preview: failures });
            } else {
              result.textContent = JSON.stringify(await workflow(api.host, target, 'window-files'));
            }
          } catch (error) { result.textContent = JSON.stringify({ error: error.message }); }
          finally { button.disabled = false; }
        };
      });`,
  }
  await Promise.all(
    Object.entries(files).map(([name, content]) => writeFile(join(source, name), content)),
  )
  const { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      workspaces: [{ id: projectId, name: 'Filesystem test', path: project, nodes: [] }],
      settings: { language: 'en' },
    })
    await pluginCli(userDataDir, ['install', source])
    const backend = await pluginCli<FileWorkflowResult>(userDataDir, [
      'run',
      id,
      'verify-files',
      '--params',
      JSON.stringify({ projectId }),
    ])
    expectWorkflow(backend, 'backend-files')
    expect(await savedCommandNodes(page, id)).toEqual([])
    expect(await readdir(project)).toEqual([])
    await page.getByTestId(`workspace-canvas-action-bar-new-plugin:${id}`).click()
    const view = page
      .locator('.workspace-main')
      .getByTestId(`plugin-view-${id}`)
      .frameLocator('iframe')
    await expect(view.locator('#run')).toBeEnabled()
    await clickPluginControl(view.locator('#run'))
    await expect(view.locator('#result')).toContainText('emptyAfterDelete', { timeout: 20_000 })
    expectWorkflow(
      JSON.parse((await view.locator('#result').textContent()) ?? '{}'),
      'window-files',
    )
    expect(await readdir(project)).toEqual([])
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId(`settings-plugin-details-${id}`).click()
    await page.getByTestId('plugin-runtime-preview-toggle').click()
    const preview = page.getByTestId('plugin-node-preview').frameLocator('iframe')
    await expect(preview.locator('#run')).toBeEnabled()
    await clickPluginControl(preview.locator('#run'))
    await expect(preview.locator('#result')).toContainText('Preview cannot access')
    const sample = JSON.parse((await preview.locator('#result').textContent()) ?? '{}')
    expect(sample.preview).toEqual({
      read: expect.stringContaining('Preview cannot access'),
      write: expect.stringContaining('Preview cannot access'),
      watch: expect.stringContaining('Preview cannot access'),
    })
    expect(await readdir(project)).toEqual([])
  } finally {
    await electronApp.close()
    await removePathWithRetry(userDataDir)
    await removePathWithRetry(root)
  }
})
