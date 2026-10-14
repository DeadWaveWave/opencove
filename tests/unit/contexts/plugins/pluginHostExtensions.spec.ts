// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeLocalPluginPackage } from '../../../../src/contexts/plugins/domain/localPluginValidation'
import {
  resolveHostTheme,
  availablePluginThemes,
} from '../../../../src/contexts/plugins/domain/pluginThemes'
import { isValidUiTheme } from '../../../../src/contexts/settings/domain/uiSettings'
import { normalizeAgentSettings } from '../../../../src/contexts/settings/domain/agentSettings'
import { PluginInstallationManager } from '../../../../src/contexts/plugins/application/PluginInstallationManager'
import { LocalPluginFiles } from '../../../../src/contexts/plugins/infrastructure/LocalPluginFiles'
import { PLUGIN_PREFERENCES_KEY } from '../../../../src/contexts/plugins/application/pluginPreferences'

const base = {
  apiVersion: 1,
  id: 'extension-fixture',
  version: '1.0.0',
  displayName: 'Extension fixture',
  description: 'Generic host extension fixture.',
}
const preferences = [
  { id: 'count', title: 'Count', type: 'number', default: 3, minimum: 1, maximum: 10 },
  { id: 'enabled', title: 'Enabled', type: 'boolean', default: true },
]
const themes = [
  { id: 'dusk', title: 'Dusk', appearance: 'dark', tokens: { '--cove-accent': '#87bfff' } },
]
const directories: string[] = []
const managers: PluginInstallationManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.dispose()))
  await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('host extension declarations', () => {
  it.each([{ preferences }, { themes }])(
    'supports declarative packages with no backend or window',
    contributes => {
      const result = normalizeLocalPluginPackage({ ...base, contributes })
      expect(result.view).toBeUndefined()
      expect(result.main).toBeUndefined()
      expect(result.contributes?.actionBar).toBe(false)
    },
  )
  it.each([
    { preferences: [{ ...preferences[0], default: '3' }] },
    { preferences: [{ ...preferences[0], default: 11 }] },
    { preferences: [{ ...preferences[0], minimum: 5, maximum: 1 }] },
    { preferences: [{ ...preferences[0], enum: [1, 1] }] },
    { preferences: [{ ...preferences[1], enum: [true, 'false'] }] },
    { preferences: [preferences[0], preferences[0]] },
    { themes: [{ ...themes[0], appearance: 'system' }] },
    { themes: [{ ...themes[0], tokens: { '--cove-accent': 'url(https://example.com)' } }] },
    { themes: [{ ...themes[0], tokens: { '--private-host-css': '#112233' } }] },
    { themes: [{ ...themes[0], tokens: {} }] },
  ])('rejects invalid preference schema and theme tokens %j', contributes => {
    expect(() => normalizeLocalPluginPackage({ ...base, contributes })).toThrow()
  })
  it('preserves durable theme identity while unavailable contributions fall back', () => {
    const selected = 'plugin:extension-fixture:dusk'
    expect(isValidUiTheme(selected)).toBe(true)
    expect(normalizeAgentSettings({ uiTheme: selected }).uiTheme).toBe(selected)
    const plugin = {
      ...base,
      nodeKinds: [],
      actionBar: false,
      contextMenu: false,
      enabled: true,
      status: 'ready' as const,
      themes: normalizeLocalPluginPackage({ ...base, contributes: { themes } }).contributes!.themes,
    }
    expect(resolveHostTheme(selected, [plugin]).theme?.baseScheme).toBe('dark')
    expect(resolveHostTheme(selected, [{ ...plugin, enabled: false }])).toEqual({ id: 'dark' })
    expect(availablePluginThemes([{ ...plugin, status: 'error' }])).toEqual([])
    expect(resolveHostTheme(selected, [])).toEqual({ id: 'dark' })
  })
})

it('durably owns schema settings across restart, preserves unknown values, and isolates previews', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-host-extensions-'))
  directories.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  const manifest = {
    ...base,
    view: { entry: 'index.html' },
    preview: 'index.html',
    contributes: { preferences, themes },
  }
  await writeFile(join(source, 'opencove.plugin.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'index.html'), '<html><body>Fixture</body></html>')
  const files = new LocalPluginFiles(join(root, 'profile'))
  const start = vi.fn()
  const create = () => {
    const manager = new PluginInstallationManager({
      files,
      backend: { start },
      createId: randomUUID,
      reservedIds: [],
      scheduleViewExpiry: () => () => {},
    })
    managers.push(manager)
    return manager
  }
  let manager = create()
  await manager.install(source)
  expect(await manager.preferencesGet(base.id)).toEqual({ count: 3, enabled: true })
  await manager.preferencesSet(base.id, 'count', 7)
  await expect(manager.preferencesSet(base.id, 'count', 20)).rejects.toThrow('Invalid')
  await expect(manager.preferencesSet(base.id, 'undeclared', 1)).rejects.toThrow('Invalid')
  const real = await manager.openView({ pluginId: base.id, nodeId: 'real' })
  await expect(manager.storageGet(real.viewId, PLUGIN_PREFERENCES_KEY)).rejects.toThrow('reserved')
  await expect(manager.storageSet(real.viewId, PLUGIN_PREFERENCES_KEY, {})).rejects.toThrow(
    'reserved',
  )
  const preview = await manager.openView({ pluginId: base.id, nodeId: 'preview', preview: true })
  expect(await manager.viewPreferencesGet(preview.viewId)).toEqual({ count: 3, enabled: true })
  await manager.viewPreferencesSet(preview.viewId, 'count', 5)
  expect((await manager.preferencesGet(base.id)).count).toBe(7)
  await manager.setEnabled(base.id, false)
  await manager.preferencesSet(base.id, 'count', 8)
  await expect(manager.viewPreferencesSet(real.viewId, 'count', 1)).rejects.toThrow()
  await manager.preferencesSet(base.id, 'count', 7)
  await manager.dispose()
  manager = create()
  expect((await manager.preferencesGet(base.id)).count).toBe(7)
  await manager.setEnabled(base.id, true)
  await writeFile(
    join(source, 'opencove.plugin.json'),
    JSON.stringify({ ...manifest, contributes: { preferences: preferences.slice(1), themes } }),
  )
  await manager.reload(base.id)
  await manager.preferencesSet(base.id, 'enabled', false)
  expect(await files.readStorage(base.id, PLUGIN_PREFERENCES_KEY)).toEqual({
    count: 7,
    enabled: false,
  })
  await writeFile(join(source, 'opencove.plugin.json'), JSON.stringify(manifest))
  await manager.reload(base.id)
  expect(await manager.preferencesGet(base.id)).toEqual({ count: 7, enabled: false })
  expect(start).not.toHaveBeenCalled()
})
