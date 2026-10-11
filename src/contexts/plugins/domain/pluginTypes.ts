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

/** Color-only host tokens. Stylesheets, selectors, URLs and expressions are not extensions. */
export const PLUGIN_THEME_TOKENS = [
  '--cove-app-background',
  '--cove-app-background-elevated',
  '--cove-surface',
  '--cove-surface-strong',
  '--cove-window-surface',
  '--cove-surface-hover',
  '--cove-field',
  '--cove-border',
  '--cove-border-subtle',
  '--cove-text',
  '--cove-text-muted',
  '--cove-text-faint',
  '--cove-accent',
  '--cove-accent-text',
  '--cove-accent-foreground',
  '--cove-focus-ring',
  '--cove-node-surface',
  '--cove-node-header-surface',
  '--cove-node-border',
  '--cove-terminal-background',
  '--cove-terminal-foreground',
  '--cove-terminal-cursor',
  '--cove-terminal-selection',
  '--cove-canvas-dot',
  '--cove-terminal-ansi-black',
  '--cove-terminal-ansi-red',
  '--cove-terminal-ansi-green',
  '--cove-terminal-ansi-yellow',
  '--cove-terminal-ansi-blue',
  '--cove-terminal-ansi-magenta',
  '--cove-terminal-ansi-cyan',
  '--cove-terminal-ansi-white',
  '--cove-terminal-ansi-bright-black',
  '--cove-terminal-ansi-bright-red',
  '--cove-terminal-ansi-bright-green',
  '--cove-terminal-ansi-bright-yellow',
  '--cove-terminal-ansi-bright-blue',
  '--cove-terminal-ansi-bright-magenta',
  '--cove-terminal-ansi-bright-cyan',
  '--cove-terminal-ansi-bright-white',
  '--cove-pixel-blue',
  '--cove-pixel-cyan',
  '--cove-pixel-mint',
] as const
export type PluginThemeToken = (typeof PLUGIN_THEME_TOKENS)[number]
export interface PluginThemeDeclaration {
  id: string
  title: string
  appearance: 'light' | 'dark'
  tokens: Partial<Record<PluginThemeToken, string>>
}
