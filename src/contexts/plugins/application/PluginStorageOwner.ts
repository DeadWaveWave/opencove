import type { PluginFilesPort } from './PluginRuntimePorts'
import type { PluginRuntimeState, PluginRuntimeView } from './PluginRuntimeState'
import {
  PLUGIN_PREFERENCES_KEY,
  readPluginPreferences,
  writePluginPreference,
  resolvePluginPreferences,
} from './pluginPreferences'

/** Installation lifecycle owns serialization; this owner owns storage scope and preference semantics. */
export class PluginStorageOwner {
  constructor(
    private readonly options: {
      files: PluginFilesPort
      runtime(pluginId: string): Promise<PluginRuntimeState>
      view(viewId: string): PluginRuntimeView
      transact<T>(operation: () => Promise<T>): Promise<T>
    },
  ) {}

  async preferencesGet(pluginId: string) {
    return await readPluginPreferences(this.options.files, await this.options.runtime(pluginId))
  }
  async preferencesSet(pluginId: string, key: string, value: unknown, assertActive?: () => void) {
    return await this.options.transact(async () => {
      assertActive?.()
      const runtime = await this.options.runtime(pluginId)
      assertActive?.()
      return writePluginPreference(this.options.files, runtime, key, value, assertActive)
    })
  }
  async viewPreferencesGet(viewId: string) {
    const view = this.options.view(viewId)
    return view.context.preview
      ? resolvePluginPreferences(
          view.runtime.record.package.contributes?.preferences ?? [],
          view.storage.get(PLUGIN_PREFERENCES_KEY),
        )
      : await readPluginPreferences(this.options.files, view.runtime)
  }
  async viewPreferencesSet(viewId: string, key: string, value: unknown) {
    return await this.options.transact(async () => {
      const view = this.options.view(viewId)
      const files = view.context.preview
        ? {
            readStorage: async () => view.storage.get(PLUGIN_PREFERENCES_KEY),
            writeStorage: async (_id: string, _key: string, next: unknown) => {
              view.storage.set(PLUGIN_PREFERENCES_KEY, next)
            },
          }
        : this.options.files
      return await writePluginPreference(files, view.runtime, key, value, () => {
        if (this.options.view(viewId) !== view) {
          throw new Error('Plugin view is no longer active.')
        }
      })
    })
  }
  async get(viewId: string, key: string): Promise<unknown> {
    this.assertPublicKey(key)
    const view = this.options.view(viewId)
    return view.context.preview
      ? (view.storage.get(key) ?? null)
      : await this.options.files.readStorage(view.context.pluginId, key)
  }
  async set(viewId: string, key: string, value: unknown): Promise<void> {
    this.assertPublicKey(key)
    await this.options.transact(async () => {
      const view = this.options.view(viewId)
      if (view.context.preview) {
        view.storage.set(key, value)
      } else {
        await this.options.files.writeStorage(view.context.pluginId, key, value)
      }
    })
  }
  private assertPublicKey(key: string): void {
    if (key === PLUGIN_PREFERENCES_KEY) {
      throw new Error('This storage key is reserved to host preferences.')
    }
  }
}
