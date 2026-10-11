import type { PluginThemeResources } from '../domain/pluginThemeResources'
import type { PluginGitSource } from '../domain/pluginDistributionTypes'
import type {
  LocalPluginPackage,
  PluginCommandContext,
  PluginViewContext,
} from '../domain/pluginRuntimeTypes'

export interface PluginInstallationRecord {
  package: LocalPluginPackage
  sourceDirectory: string
  revision: string
  enabled: boolean
  distribution?: PluginGitSource
  history?: PluginCodeVersion[]
}

export type PluginCodeVersion = Omit<PluginInstallationRecord, 'enabled' | 'history'>

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
  readDetails(
    snapshot: PluginSnapshot,
  ): Promise<{ readme: string; assets: Record<string, string> } & PluginThemeResources>
  readSkill(snapshot: PluginSnapshot, path: string): Promise<{ content: string; path: string }>
  dataDirectory(pluginId: string): string
  removePreviewData(pluginId: string, viewId: string): Promise<void>
  readStorage(pluginId: string, key: string): Promise<unknown>
  writeStorage(pluginId: string, key: string, value: unknown): Promise<void>
}

export interface PluginBackend {
  invoke(method: string, params: unknown, context: PluginViewContext): Promise<unknown>
  runCommand?(commandId: string, params: unknown, context: PluginCommandContext): Promise<unknown>
  dispose(): Promise<void>
}

export interface PluginBackendPort {
  start(
    snapshot: PluginSnapshot,
    options: {
      dataDirectory: string
      log: (message: string) => void
      unavailable: (message: string) => void
      hostRequest?: (operation: string, payload: unknown) => Promise<unknown>
      hostClosed?: () => void | Promise<void>
    },
  ): Promise<PluginBackend>
}
