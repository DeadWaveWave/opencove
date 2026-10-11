// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { writePluginPreference } from '../../../../src/contexts/plugins/application/pluginPreferences'
import { PluginStorageOwner } from '../../../../src/contexts/plugins/application/PluginStorageOwner'
import type { PluginRuntimeState } from '../../../../src/contexts/plugins/application/PluginRuntimeState'
import type { PluginFilesPort } from '../../../../src/contexts/plugins/application/PluginRuntimePorts'

const runtime = {
  record: {
    package: {
      id: 'p',
      contributes: { preferences: [{ id: 'label', type: 'string', default: '' }] },
    },
  },
} as unknown as PluginRuntimeState

it('does not write a preference after its caller retires while storage is being read', async () => {
  let done!: (value: unknown) => void
  const files = {
    readStorage: () =>
      new Promise(resolve => {
        done = resolve
      }),
    writeStorage: vi.fn(),
  }
  let active = true
  const pending = writePluginPreference(files, runtime, 'label', 'new', () => {
    if (!active) {
      throw new Error('retired')
    }
  })
  active = false
  done({ label: 'old' })
  await expect(pending).rejects.toThrow('retired')
  expect(files.writeStorage).not.toHaveBeenCalled()
})

it('rechecks authority inside the installation queue before reading or writing', async () => {
  let dispatch!: () => Promise<unknown>
  const files = { readStorage: vi.fn(), writeStorage: vi.fn() } as unknown as PluginFilesPort
  const runtimeLookup = vi.fn(async () => runtime)
  const storage = new PluginStorageOwner({
    files,
    runtime: runtimeLookup,
    view: vi.fn(),
    transact: operation =>
      new Promise((resolve, reject) => {
        dispatch = () => operation().then(resolve, reject)
      }),
  })
  let active = true
  const pending = storage.preferencesSet('p', 'label', 'new', () => {
    if (!active) {
      throw new Error('retired')
    }
  })
  active = false
  await dispatch()
  await expect(pending).rejects.toThrow('retired')
  expect(runtimeLookup).not.toHaveBeenCalled()
  expect(files.writeStorage).not.toHaveBeenCalled()
})
