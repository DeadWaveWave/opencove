import type {
  PluginCommandDeclaration,
  PluginIconDeclaration,
  PluginManifest,
  PluginSkillDeclaration,
  PluginViewDefinition,
} from './pluginTypes'

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
  view?: Partial<Omit<PluginViewDefinition, 'entry'>> & { entry: string }
  preview?: string
  readme?: string
  contributes?: {
    actionBar?: boolean
    contextMenu?: boolean
    commands?: PluginCommandDeclaration[]
    skills?: PluginSkillDeclaration[]
  }
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

export interface PluginCommandContext {
  pluginId: string
}

export interface PluginCommandTarget {
  nodeId?: string
  viewId?: string
}

export interface PluginLiveView {
  nodeId: string
  viewId: string
  ready: boolean
  contentTitle?: string
}

export interface PluginSkillDetails {
  pluginId: string
  skill: PluginSkillDeclaration
  content: string
  /** Absolute path on the connected Worker; not necessarily on the CLI machine. */
  path: string
  installPrompt: string
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
