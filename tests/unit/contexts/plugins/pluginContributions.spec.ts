// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writePluginHostTestFixture } from './pluginHostTestFixture'
import { PluginInstallationManager } from '../../../../src/contexts/plugins/application/PluginInstallationManager'
import type { PluginBackendPort } from '../../../../src/contexts/plugins/application/PluginRuntimePorts'
import { normalizeLocalPluginPackage } from '../../../../src/contexts/plugins/domain/localPluginValidation'
import { LocalPluginFiles } from '../../../../src/contexts/plugins/infrastructure/LocalPluginFiles'
import { NodePluginBackend } from '../../../../src/contexts/plugins/infrastructure/NodePluginBackend'

let root: string
let source: string
const managers: PluginInstallationManager[] = []
const base = {
  apiVersion: 1,
  id: 'command-example',
  version: '1.0.0',
  displayName: 'Command example',
  description: 'Commands and skills fixture',
}
const globalCommand = { id: 'status', title: 'Status', description: 'Read state', target: 'plugin' }
const windowCommand = {
  id: 'play',
  title: 'Play',
  description: 'Play in this window',
  target: 'window',
}
const skill = {
  id: 'command-help',
  description: 'Use this plugin',
  path: 'skills/command-help/SKILL.md',
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'opencove-plugin-contributions-'))
  source = join(root, 'source')
  await mkdir(join(source, 'skills/command-help'), { recursive: true })
  await writeFile(join(source, 'index.html'), '<html><head></head><body>Commands</body></html>')
  await writeFile(
    join(source, skill.path),
    '---\nname: command-help\ndescription: Use this plugin\n---\nOriginal skill',
  )
})

afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.dispose()))
  await rm(root, { recursive: true, force: true })
})

function create(
  backend: PluginBackendPort = {
    start: async () => ({
      invoke: async () => null,
      runCommand: async (_id, params, context) => ({ params, context }),
      dispose: async () => undefined,
    }),
  },
) {
  const files = new LocalPluginFiles(join(root, 'profile'))
  const manager = new PluginInstallationManager({
    files,
    backend,
    createId: randomUUID,
    reservedIds: [],
    scheduleViewExpiry: () => () => {},
  })
  managers.push(manager)
  return { manager, files }
}

async function writeManifest(extra: Record<string, unknown>) {
  await writeFile(join(source, 'opencove.plugin.json'), JSON.stringify({ ...base, ...extra }))
}

function token(resourcePath: string) {
  return resourcePath.split('/')[2]
}

async function realBackend() {
  return new NodePluginBackend(await writePluginHostTestFixture(root))
}

describe('plugin declaration contracts', () => {
  it('keeps old view packages usable and defaults to multiple instances', () => {
    const pkg = normalizeLocalPluginPackage({ ...base, view: { entry: 'index.html' } })
    expect(pkg.view?.instances).toBe('multiple')
    expect(pkg.contributes).toEqual({
      actionBar: true,
      contextMenu: true,
      commands: [],
      skills: [],
      preferences: [],
      themes: [],
      sidebar: [],
    })
    expect(normalizeLocalPluginPackage(pkg)).toEqual(pkg)
  })

  it('allows window-only commands without a backend and skill-only packages without a view', () => {
    expect(
      normalizeLocalPluginPackage({
        ...base,
        view: { entry: 'index.html', instances: 'single' },
        contributes: { commands: [windowCommand] },
      }).main,
    ).toBeUndefined()
    const pkg = normalizeLocalPluginPackage({ ...base, contributes: { skills: [skill] } })
    expect(pkg.view).toBeUndefined()
    expect(pkg.contributes?.actionBar).toBe(false)
    expect(pkg.contributes?.contextMenu).toBe(false)
  })

  it.each([
    {},
    { contributes: { commands: [globalCommand] } },
    { contributes: { commands: [windowCommand] } },
    { view: { entry: 'index.html', instances: 'project' } },
    {
      view: { entry: 'index.html' },
      contributes: { commands: [{ ...windowCommand, target: 'unknown' }] },
    },
    { view: { entry: 'index.html' }, contributes: { commands: [windowCommand, windowCommand] } },
    { contributes: { skills: [skill, skill] } },
    { contributes: { skills: [{ ...skill, path: '../SKILL.md' }] } },
    { contributes: { skills: [{ ...skill, path: 'README.md' }] } },
    { contributes: { skills: [skill], actionBar: true } },
    { contributes: { skills: [skill] }, preview: 'index.html' },
  ])('rejects contradictory or invalid declarations %j', extra => {
    expect(() => normalizeLocalPluginPackage({ ...base, ...extra })).toThrow()
  })
})

describe('immutable contributed skills', () => {
  it('reads the installed revision without execution or agent-directory writes, including disabled and restored packages', async () => {
    const start = vi.fn()
    const { manager } = create({ start })
    await writeManifest({ contributes: { skills: [skill] } })
    const installed = await manager.install(source)
    expect(installed).toMatchObject({
      nodeKinds: [],
      actionBar: false,
      contextMenu: false,
      skills: [skill],
    })
    expect(installed.view).toBeUndefined()
    await expect(manager.openView({ pluginId: base.id, nodeId: 'invalid' })).rejects.toThrow(
      'does not provide a window',
    )
    const details = await manager.skill(base.id, skill.id)
    expect(details.content).toContain('Original skill')
    expect(details.path).toContain(join('plugins', 'artifacts', installed.revision!))
    expect(details.installPrompt).toContain('has not installed')
    await writeFile(join(source, skill.path), 'Changed source')
    expect((await manager.skill(base.id, skill.id)).content).toContain('Original skill')
    await manager.setEnabled(base.id, false)
    await manager.dispose()
    await rm(source, { recursive: true, force: true })
    const restored = create({ start }).manager
    expect((await restored.skill(base.id, skill.id)).content).toContain('Original skill')
    expect(start).not.toHaveBeenCalled()
    await expect(restored.skill(base.id, 'undeclared')).rejects.toThrow('not declared')
  })

  it('rejects missing declared files and bounds skill text', async () => {
    const { manager, files } = create()
    await writeManifest({ contributes: { skills: [{ ...skill, path: 'missing/SKILL.md' }] } })
    await expect(manager.install(source)).rejects.toThrow()
    expect(await files.readRegistry()).toEqual([])
    await writeManifest({ contributes: { skills: [skill] } })
    await writeFile(join(source, skill.path), 'x'.repeat(128 * 1024 + 1))
    await manager.install(source)
    await expect(manager.skill(base.id, skill.id)).rejects.toThrow('128 KiB')
  })
})

describe('plugin and window command routing', () => {
  it('keeps reported titles on real view leases and discards them on close or reload', async () => {
    await writeManifest({ view: { entry: 'index.html' }, preview: 'index.html' })
    const { manager } = create()
    await manager.install(source)
    const first = await manager.openView({ pluginId: base.id, nodeId: 'node' })
    const second = await manager.openView({ pluginId: base.id, nodeId: 'node' })
    const preview = await manager.openView({ pluginId: base.id, nodeId: 'preview', preview: true })
    manager.setViewTitle(first.viewId, '  Reading  ')
    manager.setViewTitle(second.viewId, 'Writing')
    expect(await manager.listViews(base.id)).toEqual([
      { nodeId: 'node', viewId: first.viewId, ready: false, contentTitle: 'Reading' },
      { nodeId: 'node', viewId: second.viewId, ready: false, contentTitle: 'Writing' },
    ])
    expect(() => manager.setViewTitle(preview.viewId, 'Preview')).toThrow('local to the preview')
    expect(() => manager.setViewTitle(first.viewId, ' ')).toThrow('Invalid plugin')
    expect(() => manager.setViewTitle(first.viewId, 'x'.repeat(201))).toThrow('Invalid plugin')
    await manager.closeView(first.viewId)
    expect(() => manager.setViewTitle(first.viewId, 'Late')).toThrow('expired or closed')
    expect(await manager.listViews(base.id)).toEqual([
      { nodeId: 'node', viewId: second.viewId, ready: false, contentTitle: 'Writing' },
    ])
    await manager.reload(base.id)
    expect(() => manager.setViewTitle(second.viewId, 'Late')).toThrow('expired or closed')
    const replacement = await manager.openView({ pluginId: base.id, nodeId: 'node' })
    expect(await manager.listViews(base.id)).toEqual([
      { nodeId: 'node', viewId: replacement.viewId, ready: false },
    ])
  })

  it('runs a real command-only Node backend without a window and validates the command catalog', async () => {
    await writeManifest({ main: 'main.mjs', contributes: { commands: [globalCommand] } })
    await writeFile(
      join(source, 'main.mjs'),
      `export function activate() { return { runCommand(commandId, params, context) { if (params?.large) return '字'.repeat(750000); if (params?.invalid) return { value: undefined }; return { commandId, params, context }; } }; }`,
    )
    const { manager } = create(await realBackend())
    await manager.install(source)
    expect(await manager.listViews(base.id)).toEqual([])
    expect(await manager.runCommand(base.id, 'status', { limit: 3 })).toEqual({
      commandId: 'status',
      params: { limit: 3 },
      context: { pluginId: base.id },
    })
    await expect(manager.runCommand(base.id, 'private', null)).rejects.toThrow('not declared')
    await expect(manager.runCommand(base.id, 'status', null, { nodeId: 'node' })).rejects.toThrow(
      'does not accept',
    )
    await expect(manager.runCommand(base.id, 'status', '字'.repeat(400_000))).rejects.toThrow(
      'too large',
    )
    await expect(manager.runCommand(base.id, 'status', { large: true })).rejects.toThrow('2 MiB')
    await expect(manager.runCommand(base.id, 'status', { invalid: true })).rejects.toThrow(
      'JSON values',
    )
    await manager.setEnabled(base.id, false)
    await expect(manager.runCommand(base.id, 'status', null)).rejects.toThrow('disabled')
  })

  it('rejects missing command handlers before committing installation', async () => {
    await writeManifest({ main: 'main.mjs', contributes: { commands: [globalCommand] } })
    await writeFile(
      join(source, 'main.mjs'),
      'export function activate() { return { invoke() {} }; }',
    )
    const { manager, files } = create(await realBackend())
    await expect(manager.install(source)).rejects.toThrow('runCommand')
    expect(await files.readRegistry()).toEqual([])
  })

  it('keeps old declarations and handler usable when a replacement cannot activate', async () => {
    await writeManifest({ main: 'main.mjs', contributes: { commands: [globalCommand] } })
    await writeFile(
      join(source, 'main.mjs'),
      `export function activate() { return { runCommand() { return 'original'; } }; }`,
    )
    const { manager } = create(await realBackend())
    const installed = await manager.install(source)
    await writeManifest({
      main: 'main.mjs',
      contributes: { commands: [{ ...globalCommand, id: 'replace' }] },
    })
    await writeFile(
      join(source, 'main.mjs'),
      'export function activate() { throw new Error("Invalid candidate"); }',
    )
    await expect(manager.reload(base.id)).rejects.toThrow('Invalid candidate')
    expect((await manager.list())[0]).toMatchObject({
      revision: installed.revision,
      commands: [globalCommand],
    })
    expect(await manager.runCommand(base.id, 'status', null)).toBe('original')
    await expect(manager.runCommand(base.id, 'replace', null)).rejects.toThrow('not declared')
  })

  it('cancels an in-flight backend command when its installed generation is replaced', async () => {
    await writeManifest({ main: 'main.mjs', contributes: { commands: [globalCommand] } })
    await writeFile(
      join(source, 'main.mjs'),
      `export function activate() { return { runCommand() { return new Promise(() => {}); } }; }`,
    )
    const { manager } = create(await realBackend())
    await manager.install(source)
    const pending = manager.runCommand(base.id, 'status', null)
    const rejected = expect(pending).rejects.toThrow('stopped')
    await manager.reload(base.id)
    await rejected
    expect((await manager.list())[0].enabled).toBe(true)
  })

  it('fences same-artifact reload and disable/re-enable with a volatile runtime generation', async () => {
    await writeManifest({ main: 'main.mjs', contributes: { commands: [globalCommand] } })
    await writeFile(join(source, 'main.mjs'), '')
    const runCommand = vi.fn(async () => 'executed')
    const { manager, files } = create({
      start: async () => ({ invoke: async () => null, runCommand, dispose: async () => {} }),
    })
    const installed = await manager.install(source)
    const snapshot = await files.restore((await files.readRegistry())[0])
    vi.spyOn(files, 'snapshot').mockResolvedValue(snapshot)
    const reloaded = await manager.reload(base.id)
    expect(reloaded.revision).toBe(installed.revision)
    expect(reloaded.runtimeGeneration).not.toBe(installed.runtimeGeneration)
    await expect(manager.runCommand(base.id, 'status', null, {}, installed)).rejects.toThrow(
      'changed before command dispatch',
    )
    expect(runCommand).not.toHaveBeenCalled()
    expect(await manager.runCommand(base.id, 'status', null, {}, reloaded)).toBe('executed')
    await manager.setEnabled(base.id, false)
    const enabled = await manager.setEnabled(base.id, true)
    expect(enabled.revision).toBe(reloaded.revision)
    expect(enabled.runtimeGeneration).not.toBe(reloaded.runtimeGeneration)
    await expect(manager.runCommand(base.id, 'status', null, {}, reloaded)).rejects.toThrow(
      'changed before command dispatch',
    )
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('checks the dispatch generation after waiting for startup', async () => {
    await writeManifest({ main: 'main.mjs', contributes: { commands: [globalCommand] } })
    await writeFile(join(source, 'main.mjs'), '')
    const runCommand = vi.fn(async () => 'executed')
    const { manager } = create({
      start: async () => ({ invoke: async () => null, runCommand, dispose: async () => {} }),
    })
    const installed = await manager.install(source)
    let release!: () => void
    vi.spyOn(manager, 'start').mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve
        }),
    )
    const pending = manager.runCommand(base.id, 'status', null, {}, installed)
    const rejected = expect(pending).rejects.toThrow('changed before command dispatch')
    await manager.reload(base.id)
    release()
    await rejected
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('dispatches once to an explicit ready window and rejects preview, missing node, and client ambiguity', async () => {
    await writeManifest({
      view: { entry: 'index.html' },
      preview: 'index.html',
      contributes: { commands: [windowCommand] },
    })
    const { manager } = create()
    await manager.install(source)
    const preview = await manager.openView({ pluginId: base.id, nodeId: 'node', preview: true })
    expect(manager.connectViewCommands(token(preview.resourcePath), vi.fn())).toBeNull()
    const first = await manager.openView({ pluginId: base.id, nodeId: 'node' })
    const firstSend = vi.fn()
    const connection = manager.connectViewCommands(token(first.resourcePath), firstSend)!
    await expect(manager.runCommand(base.id, 'play', null)).rejects.toThrow('explicit nodeId')
    await expect(manager.runCommand(base.id, 'play', null, { nodeId: 'node' })).rejects.toThrow(
      'not ready',
    )
    connection.receive({ type: 'ready', protocol: 2, ready: true })
    const second = await manager.openView({ pluginId: base.id, nodeId: 'node' })
    const secondSend = vi.fn()
    const secondConnection = manager.connectViewCommands(token(second.resourcePath), secondSend)!
    secondConnection.receive({ type: 'ready', protocol: 2, ready: true })
    expect(await manager.listViews(base.id)).toEqual([
      { nodeId: 'node', viewId: first.viewId, ready: true },
      { nodeId: 'node', viewId: second.viewId, ready: true },
    ])
    await expect(manager.runCommand(base.id, 'play', null, { nodeId: 'node' })).rejects.toThrow(
      'multiple clients',
    )
    await expect(
      manager.runCommand(base.id, 'play', null, { nodeId: 'other', viewId: first.viewId }),
    ).rejects.toThrow('not ready')
    const pending = manager.runCommand(
      base.id,
      'play',
      { track: 'one' },
      { nodeId: 'node', viewId: first.viewId },
    )
    await vi.waitFor(() => expect(firstSend).toHaveBeenCalledTimes(1))
    const sent = firstSend.mock.calls[0][0]
    expect(sent).toMatchObject({ type: 'command', commandId: 'play', params: { track: 'one' } })
    connection.receive({
      type: 'result',
      protocol: 2,
      requestId: sent.requestId,
      ok: true,
      value: { playing: true },
    })
    expect(await pending).toEqual({ playing: true })
    expect(secondSend).not.toHaveBeenCalled()
    const interrupted = manager.runCommand(base.id, 'play', null, {
      nodeId: 'node',
      viewId: first.viewId,
    })
    const rejected = expect(interrupted).rejects.toThrow()
    await vi.waitFor(() => expect(firstSend).toHaveBeenCalledTimes(2))
    await manager.reload(base.id)
    await rejected
    expect(await manager.listViews(base.id)).toEqual([])
  })
})
