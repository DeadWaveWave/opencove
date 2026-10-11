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
import { pluginCli } from './plugins.commands.helpers'
import { clickPluginControl } from './plugins.local.helpers'

test('uses canvas and terminal APIs from a real backend and window and retires observation leases', async () => {
  test.setTimeout(90_000)
  const source = await mkdtemp(join(tmpdir(), 'opencove-canvas-plugin-'))
  const userDataDir = await createTestUserDataDir()
  const id = 'canvas-workflow'
  await writeFile(
    join(source, 'opencove.plugin.json'),
    JSON.stringify({
      apiVersion: 1,
      id,
      version: '1.0.0',
      displayName: 'Canvas workflow',
      description: 'Canvas fixture',
      main: 'main.mjs',
      view: { entry: 'index.html' },
      preview: 'index.html',
      contributes: {
        actionBar: true,
        commands: [{ id: 'run', title: 'Run', description: 'Canvas flow', target: 'plugin' }],
      },
    }),
  )
  const shared = `async function workflow(host, target) {
    const lease = await host.events.subscribe({projectId:target.projectId,types:['node']});
    const created = await host.nodes.create({target,kind:'note',title:'API note',data:{text:'before'}});
    await host.nodes.update({nodeId:created.node.id,kind:'note',data:{text:'after'}});
    const note = await host.nodes.get({nodeId:created.node.id});
    const terminal = await host.terminals.create({target,title:'API terminal'});
    await host.terminals.write({nodeId:terminal.node.id,data:'echo canvas-workflow-complete\\n'});
    let text = '';
    for(let i=0;i<100;i++){ text=(await host.terminals.read({nodeId:terminal.node.id})).output; if(text.includes('canvas-workflow-complete'))break; await new Promise(r=>setTimeout(r,50)); }
    await host.terminals.stop({nodeId:terminal.node.id});
    await host.nodes.focus({nodeId:created.node.id});
    await new Promise(r=>setTimeout(r,300));
    const events = await host.events.poll(lease);
    await host.events.dispose(lease);
    let disposed = false; try { await host.events.poll(lease); } catch { disposed=true; }
    await host.nodes.close({nodeId:terminal.node.id});
    const list=await host.nodes.list({projectId:target.projectId});
    await host.nodes.close({nodeId:created.node.id});
    return {note,text,events,disposed,kinds:list.nodes.map(n=>n.kind)};
  }`
  await writeFile(
    join(source, 'main.mjs'),
    `${shared}\nexport function activate({host}){return {runCommand(_id,params){return workflow(host,params)}}}`,
  )
  await writeFile(
    join(source, 'index.html'),
    '<!doctype html><html><head><script src="app.js" defer></script></head><body><button id="run" disabled>Run</button><pre id="result"></pre></body></html>',
  )
  await writeFile(
    join(source, 'app.js'),
    `${shared}\n(async()=>{const api=window.opencovePlugin; const context=await api.ready;document.querySelector('#run').disabled=false;document.querySelector('#run').onclick=async()=>{try{document.querySelector('#result').textContent=JSON.stringify(await workflow(api.host,{projectId:context.workspaceId||'${seededWorkspaceId}'}))}catch(e){document.querySelector('#result').textContent=e.message}}})()`,
  )
  const { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await clearAndSeedWorkspace(page, [], { settings: { language: 'en' } })
    await pluginCli(userDataDir, ['install', source])
    const result = await pluginCli(userDataDir, [
      'run',
      id,
      'run',
      '--params',
      JSON.stringify({ projectId: seededWorkspaceId }),
    ])
    expect(result).toMatchObject({
      note: { node: { data: { text: 'after' } } },
      text: expect.stringContaining('canvas-workflow-complete'),
      disposed: true,
      events: {
        changes: expect.arrayContaining([
          expect.objectContaining({ type: 'node', change: 'created' }),
        ]),
      },
    })
    await page.getByTestId(`workspace-canvas-action-bar-new-plugin:${id}`).click()
    const view = page
      .locator('.workspace-main')
      .getByTestId(`plugin-view-${id}`)
      .frameLocator('iframe')
    await expect(view.locator('#run')).toBeEnabled()
    await clickPluginControl(view.locator('#run'))
    await expect(view.locator('#result')).toContainText('"disposed":true')
    expect(JSON.parse(await view.locator('#result').innerText()).kinds).toContain('plugin')
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
