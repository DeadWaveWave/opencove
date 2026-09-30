import type { PluginIconDeclaration, PluginManifest, PluginViewDefinition } from './pluginTypes'

/** Public source-directory contract. Version 1 is still a development API. */
export interface LocalPluginPackage {
  apiVersion: 1
  id: string
  version: string
  displayName: string
  description: string
  author?: string
  icon?: PluginIconDeclaration
  main?: string
  view: Partial<Omit<PluginViewDefinition, 'entry'>> & { entry: string }
  preview?: string
  readme?: string
  contributes?: { actionBar?: boolean; contextMenu?: boolean }
  platforms?: Array<'darwin' | 'linux' | 'win32'>
}

export interface PluginDetails {
  plugin: PluginManifest
  readme: string
  assets: Record<string, string>
  sourceDirectory: string | null
  logs: string[]
}

export interface PluginViewContext {
  pluginId: string
  nodeId: string
  workspaceId: string | null
  directoryPath: string | null
  preview: boolean
}

export interface PluginOpenViewResult {
  viewId: string
  resourcePath: string
  revision: string
  context: PluginViewContext
}

export interface PluginOpenViewInput {
  pluginId: string
  nodeId: string
  workspaceId?: string | null
  directoryPath?: string | null
  preview?: boolean
}
