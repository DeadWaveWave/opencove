import { expect, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCommand } from '../../src/platform/process/runCommand'

export interface PluginWindowResult {
  nodeId: string
  projectId: string
  created: boolean
}

export interface PluginWindowList {
  windows: Array<{
    nodeId: string
    projectId: string
    views: Array<{ nodeId: string; viewId: string; ready: boolean }>
  }>
}

interface CliResult<T> {
  ok: boolean
  value?: T
  error?: { debugMessage?: string; message?: string }
}

async function cli(userDataDir: string, args: string[]) {
  const execution = await runCommand(
    process.execPath,
    [resolve(__dirname, '../../src/app/cli/opencove.mjs'), 'plugin', ...args],
    resolve(__dirname, '../..'),
    {
      timeoutMs: 45_000,
      captureMaxBytes: 4 * 1024 * 1024,
      env: { ...process.env, OPENCOVE_USER_DATA_DIR: userDataDir },
    },
  )
  if (!execution.stdout.trim()) {
    throw new Error(`Plugin CLI produced no result: ${execution.stderr}`)
  }
  return { execution, result: JSON.parse(execution.stdout) as CliResult<unknown> }
}

export async function pluginCli<T>(userDataDir: string, args: string[]): Promise<T> {
  const { execution, result } = await cli(userDataDir, args)
  expect(execution.exitCode, result.error?.debugMessage ?? execution.stderr).toBe(0)
  expect(result.ok).toBe(true)
  return result.value as T
}

export async function pluginCliFailure(userDataDir: string, args: string[]): Promise<string> {
  const { execution, result } = await cli(userDataDir, args)
  expect(execution.exitCode).toBe(1)
  expect(result.ok).toBe(false)
  return result.error?.debugMessage ?? result.error?.message ?? JSON.stringify(result.error)
}

export async function createCommandPlugin(instances: 'single' | 'multiple') {
  const directory = await mkdtemp(join(tmpdir(), 'opencove-command-plugin-'))
  const id = `command-fixture-${instances}`
  await mkdir(join(directory, 'skills', 'commands'), { recursive: true })
  const files = {
    'opencove.plugin.json': JSON.stringify({
      apiVersion: 1,
      id,
      version: '1.0.0',
      displayName: 'Command fixture',
      description: 'Independent fixture for actual CLI and window command delivery.',
      main: 'main.mjs',
      view: {
        entry: 'index.html',
        instances,
        width: 480,
        height: 300,
        minWidth: 320,
        minHeight: 220,
      },
      preview: 'index.html',
      readme: 'README.md',
      contributes: {
        actionBar: true,
        contextMenu: true,
        commands: [
          {
            id: 'inspect',
            title: 'Inspect',
            description: 'Runs without a window.',
            target: 'plugin',
          },
          {
            id: 'set-label',
            title: 'Set label',
            description: 'Updates the selected live document.',
            target: 'window',
          },
        ],
        skills: [
          {
            id: 'commands',
            description: 'Use the command fixture.',
            path: 'skills/commands/SKILL.md',
          },
        ],
      },
    }),
    'main.mjs': `export function activate() {
      return { runCommand(commandId, params, context) {
        if (commandId !== 'inspect') throw new Error('Unknown command');
        return { pluginId: context.pluginId, hasWindow: Object.hasOwn(context, 'view'), params };
      } };
    }`,
    'index.html': `<!doctype html><html><head><meta charset="utf-8">
      <link rel="stylesheet" href="style.css"><script src="view.js" defer></script></head>
      <body><main><h2>Window command</h2><output id="label">Starting</output>
      <p id="ready">Connecting</p><p id="executions">0</p></main></body></html>`,
    'view.js': `const api = window.opencovePlugin;
      api.ready.then(async context => {
        const output = document.querySelector('#label');
        output.textContent = (await api.storage.get('label')) ?? 'Idle';
        let executions = 0;
        api.onCommand(async (commandId, params) => {
          if (commandId !== 'set-label' || typeof params?.label !== 'string') throw new Error('Invalid command');
          await api.storage.set('label', params.label);
          output.textContent = params.label;
          document.querySelector('#executions').textContent = String(++executions);
          return { nodeId: context.nodeId, label: params.label, executions, preview: context.preview };
        });
        document.querySelector('#ready').textContent = 'Ready';
      }).catch(error => { document.querySelector('#ready').textContent = error.message; });`,
    'style.css': `:root { color: var(--cove-text); background: var(--cove-window-surface); font: 13px/1.5 system-ui; }
      body { margin: 0; padding: 16px; } h2 { font-size: 14px; margin: 0 0 12px; }
      output { display: block; overflow-wrap: anywhere; } p { color: var(--cove-text-muted); }`,
    'README.md': '# Command fixture\nIndependently installed command delivery fixture.\n',
    'skills/commands/SKILL.md': `---\nname: command-fixture\ndescription: Operate the installed command fixture.\n---\nUse opencove plugin windows ${id} before choosing a window command target.\n`,
  }
  await Promise.all(
    Object.entries(files).map(([name, text]) => writeFile(join(directory, name), text)),
  )
  return { directory, id }
}

export function canvasPluginNode(page: Page, nodeId: string): Locator {
  return page.locator(`.workspace-main .react-flow__node[data-id="${nodeId}"]`)
}

export async function expectCommandReady(node: Locator): Promise<void> {
  await expect(node.frameLocator('iframe').locator('#ready')).toHaveText('Ready', {
    timeout: 15_000,
  })
}

export async function savedCommandNodes(page: Page, pluginId: string) {
  return await page.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = JSON.parse(raw ?? '{}') as {
      workspaces?: Array<{
        id: string
        nodes: Array<{ id: string; kind: string; task?: { pluginId?: string } }>
      }>
    }
    return (state.workspaces ?? []).flatMap(project =>
      project.nodes
        .filter(node => node.kind === 'plugin' && node.task?.pluginId === id)
        .map(node => ({ nodeId: node.id, projectId: project.id })),
    )
  }, pluginId)
}
