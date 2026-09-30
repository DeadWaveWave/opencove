import type { LocalPluginPackage, PluginViewContext } from '../domain/pluginRuntimeTypes'

export interface PluginInstallationRecord {
  package: LocalPluginPackage
  sourceDirectory: string
  revision: string
  enabled: boolean
}

export interface PluginSnapshot extends PluginInstallationRecord {
  directory: string
}

export interface PluginResource {
  body: Uint8Array
  contentType: string
}

export interface PluginFilesPort {
  readRegistry(): Promise<PluginInstallationRecord[]>
  writeRegistry(records: PluginInstallationRecord[]): Promise<void>
  snapshot(directory: string): Promise<PluginSnapshot>
  restore(record: PluginInstallationRecord): Promise<PluginSnapshot>
  readResource(snapshot: PluginSnapshot, path: string): Promise<PluginResource>
  readDetails(snapshot: PluginSnapshot): Promise<{ readme: string; assets: Record<string, string> }>
  dataDirectory(pluginId: string): string
  removePreviewData(pluginId: string, viewId: string): Promise<void>
  readStorage(pluginId: string, key: string): Promise<unknown>
  writeStorage(pluginId: string, key: string, value: unknown): Promise<void>
}

export interface PluginBackend {
  invoke(method: string, params: unknown, context: PluginViewContext): Promise<unknown>
  dispose(): Promise<void>
}

export interface PluginBackendPort {
  start(
    snapshot: PluginSnapshot,
    options: {
      dataDirectory: string
      log: (message: string) => void
      unavailable: (message: string) => void
    },
  ): Promise<PluginBackend>
}
