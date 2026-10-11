import type { PluginThemeResources } from './pluginThemeResources'
import type { PluginSidebarDeclaration } from './pluginSidebar'
import type {
  PluginCommandDeclaration,
  PluginIconDeclaration,
  PluginManifest,
  PluginSkillDeclaration,
  PluginViewDefinition,
  PluginPreferenceDeclaration,
  PluginThemeDeclaration,
  PluginPreferenceValue,
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
    preferences?: PluginPreferenceDeclaration[]
    themes?: PluginThemeDeclaration[]
    sidebar?: PluginSidebarDeclaration[]
  }
  platforms?: Array<'darwin' | 'linux' | 'win32'>
  engines?: { opencove: string }
}

export interface PluginDetails extends PluginThemeResources {
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

export interface PluginHostContext {
  surface: 'commandCenter' | 'canvas' | 'node' | 'space' | 'sidebar'
  projectId?: string
  spaceId?: string
  nodeIds?: string[]
}

export interface PluginCommandContext {
  pluginId: string
  host?: PluginHostContext
  preferences?: Record<string, PluginPreferenceValue>
}

export interface PluginCommandTarget {
  context?: PluginHostContext
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
