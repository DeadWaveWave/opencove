import { PluginViewLeases } from './PluginViewLeases'
import { PluginWindowCommands } from './PluginWindowCommands'
import { installedPluginManifest } from './pluginManifest'
import { listPluginViews, readPluginSkill, runPluginCommand } from './pluginContributions'
import {
  assertPluginRuntimeGeneration,
  recordPluginViewTitle,
  type PluginRuntimeState as Runtime,
  type PluginRuntimeView as View,
} from './PluginRuntimeState'
import type { PluginManifest } from '../domain/pluginTypes'
import type {
  PluginDetails,
  PluginOpenViewInput,
  PluginOpenViewResult,
  PluginViewContext,
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
    let records: PluginInstallationRecord[]
    try {
      records = await this.options.files.readRegistry()
    } catch (error) {
      this.initializationError = asError(error)
      return
    }
    // Sequential activation bounds process fan-out and observes shutdown between plugins.
    /* eslint-disable no-await-in-loop */
    for (const record of records) {
      if (this.closed) {
        return
      }
      const runtime: Runtime = { record, snapshot: null, backend: null, error: null, logs: [] }
      this.runtimes.set(record.package.id, runtime)
      try {
        if (this.options.reservedIds.includes(record.package.id)) {
          throw new Error('Plugin id belongs to a built-in plugin.')
        }
        runtime.snapshot = await this.options.files.restore(record)
        if (record.enabled && !this.closed) {
          runtime.backend = await this.startBackend(runtime)
        }
        if (this.closed) {
          await runtime.backend?.dispose()
        }
      } catch (error) {
        runtime.error = asError(error).message
      }
    }
  }

  /* eslint-enable no-await-in-loop */

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

  private addLog(runtime: Runtime, message: string): void {
    runtime.logs.push(message.slice(0, 4000))
    if (runtime.logs.length > 100) {
      runtime.logs.shift()
    }
  }

  private async startBackend(runtime: Runtime): Promise<PluginBackend | null> {
    if (!runtime.snapshot?.package.main) {
      return null
    }
    const backend = await this.options.backend.start(runtime.snapshot, {
      dataDirectory: this.options.files.dataDirectory(runtime.record.package.id),
      log: message => this.addLog(runtime, message),
      unavailable: message => {
        runtime.error = message
        this.addLog(runtime, message)
      },
    })
    if (
      runtime.record.package.contributes?.commands?.some(command => command.target === 'plugin') &&
      !backend.runCommand
    ) {
      await backend.dispose()
      throw new Error('Plugin backend must provide runCommand for declared plugin commands.')
    }
    return backend
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
      const snapshot = await this.options.files.snapshot(previous.record.sourceDirectory)
      if (snapshot.package.id !== pluginId) {
        throw new Error('Reload cannot change the plugin id.')
      }
      return await this.activate(snapshot, previous.record.enabled)
    })
  }

  private recordsReplacing(
    id: string,
    next: PluginInstallationRecord | null,
  ): PluginInstallationRecord[] {
    const records = [...this.runtimes.values()]
      .filter(item => item.record.package.id !== id)
      .map(item => item.record)
    if (next) {
      records.push(next)
    }
    return records
  }

  private async activate(snapshot: PluginSnapshot, enabled: boolean): Promise<PluginManifest> {
    const id = snapshot.package.id
    const previous = this.runtimes.get(id)
    const record = {
      package: snapshot.package,
      revision: snapshot.revision,
      sourceDirectory: snapshot.sourceDirectory,
      enabled,
    }
    const candidate: Runtime = { record, snapshot, backend: null, error: null, logs: [] }
    try {
      if (enabled) {
        candidate.backend = await this.startBackend(candidate)
      }
      this.assertOpen()
      if (candidate.error) {
        throw new Error(candidate.error)
      }
      await this.options.files.writeRegistry(this.recordsReplacing(id, record))
      // The persisted record is authoritative even if shutdown began during the write.
      this.runtimes.set(id, candidate)
    } catch (error) {
      await candidate.backend?.dispose()
      throw error
    }
    if (previous) {
      await this.retire(previous)
    }
    if (this.closed) {
      await this.retire(candidate)
    }
    return this.manifest(candidate)
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
      const context: PluginViewContext = {
        pluginId: input.pluginId,
        nodeId: input.nodeId,
        workspaceId: input.workspaceId ?? null,
        directoryPath: input.directoryPath ?? null,
        preview: input.preview === true,
      }
      const view: View = { id, token, runtime, context, backend: null, storage: new Map() }
      if (context.preview && runtime.snapshot.package.main) {
        try {
          view.backend = await this.options.backend.start(runtime.snapshot, {
            dataDirectory: `${this.options.files.dataDirectory(input.pluginId)}/previews/${id}`,
            log: message => this.addLog(runtime, `[preview] ${message}`),
            unavailable: message => this.addLog(runtime, `[preview] ${message}`),
          })
        } catch (error) {
          await this.options.files.removePreviewData(input.pluginId, id).catch(() => undefined)
          throw error
        }
      }
      if (this.closed) {
        await view.backend?.dispose().catch(() => undefined)
        if (context.preview) {
          await this.options.files.removePreviewData(input.pluginId, id).catch(() => undefined)
        }
        throw new Error('Plugin runtime is shutting down.')
      }
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
    await view.backend
      ?.dispose()
      .catch(error => this.addLog(view.runtime, `Preview cleanup: ${asError(error).message}`))
    if (view.context.preview) {
      await this.options.files
        .removePreviewData(view.context.pluginId, viewId)
        .catch(error =>
          this.addLog(view.runtime, `Preview data cleanup: ${asError(error).message}`),
        )
    }
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
    return await runPluginCommand(
      runtime,
      this.views.values().filter(view => view.runtime === runtime),
      this.windowCommands,
      commandId,
      params,
      target,
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

  async storageGet(viewId: string, key: string): Promise<unknown> {
    const view = this.getView(viewId)
    if (view.context.preview) {
      return view.storage.get(key) ?? null
    }
    return await this.options.files.readStorage(view.context.pluginId, key)
  }

  async storageSet(viewId: string, key: string, value: unknown): Promise<void> {
    await this.transact(async () => {
      const view = this.getView(viewId)
      if (view.context.preview) {
        view.storage.set(key, value)
        return
      }
      await this.options.files.writeStorage(view.context.pluginId, key, value)
    })
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

  private async retire(runtime: Runtime): Promise<void> {
    await Promise.all(
      [...this.views.values()]
        .filter(view => view.runtime === runtime)
        .map(view => this.closeView(view.id)),
    )
    await runtime.backend
      ?.dispose()
      .catch(error => this.addLog(runtime, `Runtime cleanup: ${asError(error).message}`))
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
