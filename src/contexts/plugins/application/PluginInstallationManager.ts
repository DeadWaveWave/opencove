import { cleanupPluginView } from './pluginViewCleanup'
import { PluginHostAccess } from './PluginHostAccess'
import { createPluginRuntimeView } from './createPluginRuntimeView'
import type { PluginHostPort } from '../domain/pluginHostTypes'
import { readPluginPreferences } from './pluginPreferences'
import { PluginStorageOwner } from './PluginStorageOwner'
import { restorePluginInstallations } from './pluginInstallationRestore'
import {
  publishPluginSnapshot,
  replacePluginRecord,
  startPluginBackend,
  assertPluginPublication,
} from './pluginPublication'
import type { PluginPublicationExpectation } from '../domain/pluginDistributionTypes'
import { PluginViewLeases } from './PluginViewLeases'
import { PluginWindowCommands } from './PluginWindowCommands'
import { installedPluginManifest } from './pluginManifest'
import { listPluginViews, readPluginSkill, runPluginCommand } from './pluginContributions'
import {
  assertPluginRuntimeGeneration,
  recordPluginViewTitle,
  appendPluginRuntimeLog,
  type PluginRuntimeState as Runtime,
  type PluginRuntimeView as View,
} from './PluginRuntimeState'
import type { PluginManifest } from '../domain/pluginTypes'
import type {
  PluginDetails,
  PluginOpenViewInput,
  PluginOpenViewResult,
  PluginCommandTarget,
  PluginLiveView,
  PluginSkillDetails,
} from '../domain/pluginRuntimeTypes'
import type {
  PluginBackend,
  PluginBackendPort,
  PluginFilesPort,
  PluginInstallationRecord,
  PluginResource,
  PluginSnapshot,
} from './PluginRuntimePorts'

export class PluginInstallationManager {
  private readonly host = new PluginHostAccess(
    runtime => !this.closed && this.runtimes.get(runtime.record.package.id) === runtime,
  )
  private readonly storage: PluginStorageOwner
  private readonly runtimeEpoch: string
  private readonly runtimes = new Map<string, Runtime>()
  private readonly views: PluginViewLeases<View>
  private readonly windowCommands: PluginWindowCommands
  private startup: Promise<void> | null = null
  private initializationError: Error | null = null
  private operations: Promise<unknown> = Promise.resolve()
  private closed = false
  private disposal: Promise<void> | null = null

  constructor(
    private readonly options: {
      files: PluginFilesPort
      backend: PluginBackendPort
      createId: () => string
      reservedIds: readonly string[]
      scheduleViewExpiry: (expire: () => void) => () => void
    },
  ) {
    this.storage = new PluginStorageOwner({
      files: options.files,
      view: id => this.getView(id),
      transact: task => this.transact(task),
      runtime: async id => {
        await this.start()
        this.assertOpen()
        return this.get(id)
      },
    })
    this.runtimeEpoch = options.createId()
    this.windowCommands = new PluginWindowCommands(options.createId)
    this.views = new PluginViewLeases({
      scheduleExpiry: options.scheduleViewExpiry,
      onExpired: viewId => {
        void this.closeView(viewId)
      },
    })
  }

  start(): Promise<void> {
    this.startup ??= this.restore()
    return this.startup
  }

  private async restore(): Promise<void> {
    this.initializationError = await restorePluginInstallations({
      files: this.options.files,
      reservedIds: this.options.reservedIds,
      closed: () => this.closed,
      commit: runtime => this.runtimes.set(runtime.record.package.id, runtime),
      startBackend: runtime => this.startBackend(runtime),
    })
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Plugin runtime is shutting down.')
    }
    if (this.initializationError) {
      throw this.initializationError
    }
  }

  private async transact<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(async () => {
      await this.start()
      this.assertOpen()
      return await operation()
    })
    this.operations = next.catch(() => undefined)
    return await next
  }

  private manifest(runtime: Runtime): PluginManifest {
    return installedPluginManifest(runtime)
  }

  async list(): Promise<PluginManifest[]> {
    await this.start()
    this.assertOpen()
    return [...this.runtimes.values()].map(runtime => this.manifest(runtime))
  }

  private get(pluginId: string): Runtime {
    const runtime = this.runtimes.get(pluginId)
    if (!runtime) {
      throw new Error(`Plugin is not installed: ${pluginId}`)
    }
    return runtime
  }

  async details(pluginId: string): Promise<PluginDetails> {
    await this.start()
    this.assertOpen()
    const runtime = this.get(pluginId)
    const content = runtime.snapshot
      ? await this.options.files.readDetails(runtime.snapshot)
      : { readme: '', assets: {} }
    return {
      plugin: this.manifest(runtime),
      ...content,
      sourceDirectory: runtime.record.sourceDirectory,
      logs: [...runtime.logs],
    }
  }

  async skill(pluginId: string, skillId: string): Promise<PluginSkillDetails> {
    await this.start()
    this.assertOpen()
    return await readPluginSkill(this.options.files, this.get(pluginId), skillId)
  }

  private startBackend(runtime: Runtime): Promise<PluginBackend | null> {
    return startPluginBackend(
      runtime,
      this.options.backend,
      this.options.files,
      message => appendPluginRuntimeLog(runtime, message),
      this.host.backend(runtime),
    )
  }

  async install(directory: string): Promise<PluginManifest> {
    return await this.transact(async () => {
      const snapshot = await this.options.files.snapshot(directory)
      if (this.options.reservedIds.includes(snapshot.package.id)) {
        throw new Error('A built-in plugin already uses this id.')
      }
      if (this.runtimes.has(snapshot.package.id)) {
        throw new Error('Plugin already installed. Use plugin reload to apply source changes.')
      }
      return await this.activate(snapshot, true)
    })
  }

  async reload(pluginId: string): Promise<PluginManifest> {
    return await this.transact(async () => {
      const previous = this.get(pluginId)
      if (previous.record.distribution) {
        throw new Error(
          'Managed Git source must be rebuilt through plugin reload on the control surface.',
        )
      }
      const snapshot = await this.options.files.snapshot(previous.record.sourceDirectory)
      if (snapshot.package.id !== pluginId) {
        throw new Error('Reload cannot change the plugin id.')
      }
      return await this.activate(
        { ...snapshot, distribution: previous.record.distribution },
        previous.record.enabled,
      )
    })
  }

  async installationState(pluginId: string) {
    await this.start()
    this.assertOpen()
    const runtime = this.get(pluginId)
    return {
      record: structuredClone(runtime.record),
      manifest: this.manifest(runtime),
      runtimeEpoch: this.runtimeEpoch,
    }
  }

  async publishPrepared(
    snapshot: PluginSnapshot,
    expected: PluginPublicationExpectation | null,
    beforePublish?: () => Promise<void>,
  ): Promise<PluginManifest> {
    return this.transact(async () => {
      const previous = this.runtimes.get(snapshot.package.id)
      assertPluginPublication(
        previous,
        snapshot,
        expected,
        this.runtimeEpoch,
        this.options.reservedIds,
      )
      return this.activate(snapshot, previous?.record.enabled ?? true, beforePublish)
    })
  }

  private recordsReplacing(id: string, next: PluginInstallationRecord | null) {
    return replacePluginRecord(this.runtimes.values(), id, next)
  }

  private async activate(
    snapshot: PluginSnapshot,
    enabled: boolean,
    beforePublish?: () => Promise<void>,
  ): Promise<PluginManifest> {
    const runtime = await publishPluginSnapshot(snapshot, enabled, {
      previous: this.runtimes.get(snapshot.package.id),
      beforePublish,
      files: this.options.files,
      records: this.runtimes.values(),
      startBackend: item => this.startBackend(item),
      assertOpen: () => this.assertOpen(),
      commit: item => this.runtimes.set(item.record.package.id, item),
      retire: item => this.retire(item),
      closed: () => this.closed,
    })
    return this.manifest(runtime)
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<PluginManifest> {
    return await this.transact(async () => {
      const previous = this.get(pluginId)
      if (previous.record.enabled === enabled && !previous.error) {
        return this.manifest(previous)
      }
      if (!previous.snapshot) {
        if (enabled) {
          throw new Error('Plugin artifact is unavailable; reload its source first.')
        }
        const record = { ...previous.record, enabled: false }
        await this.options.files.writeRegistry(this.recordsReplacing(pluginId, record))
        previous.record = record
        await this.retire(previous)
        return this.manifest(previous)
      }
      return await this.activate(previous.snapshot, enabled)
    })
  }

  async uninstall(pluginId: string): Promise<void> {
    await this.transact(async () => {
      const runtime = this.get(pluginId)
      await this.options.files.writeRegistry(this.recordsReplacing(pluginId, null))
      this.runtimes.delete(pluginId)
      await this.retire(runtime)
    })
  }

  async openView(input: PluginOpenViewInput): Promise<PluginOpenViewResult> {
    return await this.transact(async () => {
      const runtime = this.get(input.pluginId)
      if (!runtime.snapshot) {
        throw new Error('Plugin artifact is unavailable.')
      }
      const definition = runtime.record.package.view
      if (!definition) {
        throw new Error('Plugin does not provide a window.')
      }
      if (!input.preview && (!runtime.record.enabled || runtime.error)) {
        throw new Error(runtime.error ?? 'Plugin is disabled.')
      }
      if (input.preview && !runtime.record.package.preview) {
        throw new Error('Plugin has no preview.')
      }
      if (this.views.size >= 512) {
        throw new Error('Too many open plugin views.')
      }
      const id = this.options.createId()
      const token = this.options.createId()
      const view = await createPluginRuntimeView(input, runtime, {
        id,
        token,
        backend: this.options.backend,
        files: this.options.files,
        closed: () => this.closed,
      })
      const context = view.context
      this.views.add(id, token, view)
      const entry = context.preview ? runtime.record.package.preview! : definition.entry
      return {
        viewId: id,
        resourcePath: `/plugin-assets/${token}/${entry.split('/').map(encodeURIComponent).join('/')}`,
        revision: runtime.record.revision,
        context,
      }
    })
  }

  private getView(viewId: string): View {
    this.assertOpen()
    const view = this.views.get(viewId)
    if (!view) {
      throw new Error('Plugin view expired or closed; reopen the window.')
    }
    return view
  }

  async closeView(viewId: string): Promise<void> {
    const view = this.views.remove(viewId)
    if (!view) {
      return
    }
    this.windowCommands.retire(viewId)
    await this.host.closeView(viewId)
    await cleanupPluginView(view, this.options.files)
  }

  configureHost(port: PluginHostPort): void {
    this.host.bind(port)
  }

  hostRequest(viewId: string, operation: string, payload: unknown): Promise<unknown> {
    const view = this.getView(viewId)
    return this.host.view(view, () => this.views.get(viewId) === view, operation, payload)
  }

  async invoke(viewId: string, method: string, params: unknown): Promise<unknown> {
    const view = this.getView(viewId)
    const backend = view.context.preview ? view.backend : view.runtime.backend
    if (!backend) {
      throw new Error('Plugin does not provide a backend.')
    }
    return await backend.invoke(method, params, view.context)
  }

  async listViews(pluginId: string): Promise<PluginLiveView[]> {
    await this.start()
    this.assertOpen()
    const runtime = this.get(pluginId)
    return listPluginViews(
      this.views.values().filter(view => view.runtime === runtime),
      this.windowCommands,
    )
  }

  setViewTitle(viewId: string, title: string): void {
    recordPluginViewTitle(this.getView(viewId), title)
  }

  async runCommand(
    pluginId: string,
    commandId: string,
    params: unknown,
    target: PluginCommandTarget = {},
    expected?: Pick<PluginManifest, 'revision' | 'runtimeGeneration'>,
  ): Promise<unknown> {
    await this.start()
    this.assertOpen()
    const runtime = this.get(pluginId)
    assertPluginRuntimeGeneration(runtime, expected)
    const preferences = runtime.record.package.contributes?.preferences?.length
      ? await readPluginPreferences(this.options.files, runtime)
      : undefined
    this.assertOpen()
    if (this.get(pluginId) !== runtime) {
      throw new Error('Plugin changed before command dispatch.')
    }
    assertPluginRuntimeGeneration(runtime, expected)
    return await runPluginCommand(
      runtime,
      this.views.values().filter(view => view.runtime === runtime),
      this.windowCommands,
      commandId,
      params,
      target,
      preferences,
    )
  }

  connectViewCommands(
    token: string,
    send: (message: unknown) => void,
  ): ReturnType<PluginWindowCommands['connect']> | null {
    const view = this.closed ? undefined : this.views.getByToken(token)
    if (!view || view.context.preview) {
      return null
    }
    return this.windowCommands.connect(view.id, send)
  }

  preferencesGet(pluginId: string) {
    return this.storage.preferencesGet(pluginId)
  }
  preferencesSet(pluginId: string, key: string, value: unknown, assertActive?: () => void) {
    return this.storage.preferencesSet(pluginId, key, value, assertActive)
  }
  viewPreferencesGet(viewId: string) {
    return this.storage.viewPreferencesGet(viewId)
  }
  viewPreferencesSet(viewId: string, key: string, value: unknown) {
    return this.storage.viewPreferencesSet(viewId, key, value)
  }
  storageGet(viewId: string, key: string) {
    return this.storage.get(viewId, key)
  }
  storageSet(viewId: string, key: string, value: unknown) {
    return this.storage.set(viewId, key, value)
  }

  async resource(token: string, path: string): Promise<PluginResource | null> {
    if (this.closed) {
      return null
    }
    const view = this.views.getByToken(token)
    if (!view?.runtime.snapshot) {
      return null
    }
    return await this.options.files.readResource(view.runtime.snapshot, path)
  }

  hasResourceToken(token: string): boolean {
    return !this.closed && this.views.hasToken(token)
  }

  attachViewConnection(token: string, onRetired: () => void): (() => void) | null {
    return this.closed ? null : this.views.attach(token, onRetired)
  }

  async closeViewToken(token: string): Promise<void> {
    const view = this.views.getByToken(token)
    if (view) {
      await this.closeView(view.id)
    }
  }

  async closeNodeViews(nodeId: string): Promise<void> {
    await Promise.all(
      this.views
        .values()
        .filter(view => view.context.nodeId === nodeId && !view.context.preview)
        .map(view => this.closeView(view.id)),
    )
  }

  private async retire(runtime: Runtime): Promise<void> {
    await Promise.all(
      [...this.views.values()]
        .filter(view => view.runtime === runtime)
        .map(view => this.closeView(view.id)),
    )
    await runtime.backend
      ?.dispose()
      .catch(error => appendPluginRuntimeLog(runtime, `Runtime cleanup: ${asError(error).message}`))
  }

  beginShutdown(): void {
    this.closed = true
  }

  dispose(): Promise<void> {
    this.beginShutdown()
    this.disposal ??= (async () => {
      await this.startup
      await this.operations
      await Promise.all([...this.runtimes.values()].map(runtime => this.retire(runtime)))
    })()
    return this.disposal
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
