import type { PluginThemeDeclaration } from './pluginThemeTypes'
export {
  PLUGIN_THEME_TOKENS,
  type PluginThemeDeclaration,
  type PluginThemeToken,
} from './pluginThemeTypes'
import type { PluginSidebarDeclaration } from './pluginSidebar'

export type PluginNodeKind = string

export type PluginIconDeclaration =
  | { type: 'builtin'; name: 'git-branch' | 'puzzle' }
  | { type: 'asset'; path: string; light?: string; dark?: string }

export type PluginCommandMenu = 'commandCenter' | 'canvas' | 'node' | 'space' | 'sidebar'

export interface PluginCommandDeclaration {
  id: string
  title: string
  description: string
  usage?: string
  target: 'plugin' | 'window'
  menus?: PluginCommandMenu[]
}

export interface PluginSkillDeclaration {
  id: string
  description: string
  path: string
}

export interface PluginManifest {
  id: string
  version: string
  displayName: string
  description: string
  icon?: PluginIconDeclaration
  nodeKinds: readonly PluginNodeKind[]
  actionBar: boolean
  contextMenu: boolean
  source?: 'builtin' | 'local'
  author?: string
  revision?: string
  runtimeGeneration?: number
  enabled?: boolean
  status?: 'ready' | 'disabled' | 'error'
  error?: string | null
  view?: PluginViewDefinition
  hasPreview?: boolean
  commands?: PluginCommandDeclaration[]
  skills?: PluginSkillDeclaration[]
  preferences?: PluginPreferenceDeclaration[]
  sidebar?: PluginSidebarDeclaration[]
  themes?: PluginThemeDeclaration[]
}

export interface PluginViewDefinition {
  entry: string
  instances?: 'single' | 'multiple'
  width: number
  height: number
  minWidth: number
  minHeight: number
}

/** Host-owned node context; plugin-specific fields remain opaque and round-trip unchanged. */
export interface PluginNodePayload {
  [key: string]: unknown
  pluginId: string
  schemaVersion: number
  repoPath: string
  mountId: string | null
}

export type PluginPreferenceValue = string | number | boolean
export interface PluginPreferenceDeclaration {
  id: string
  title: string
  description?: string
  type: 'string' | 'number' | 'boolean'
  default: PluginPreferenceValue
  enum?: PluginPreferenceValue[]
  minimum?: number
  maximum?: number
}
