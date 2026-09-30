export type PluginNodeKind = string

export type PluginIconDeclaration =
  | { type: 'builtin'; name: 'git-branch' | 'puzzle' }
  | { type: 'asset'; path: string; light?: string; dark?: string }

export interface PluginCommandDeclaration {
  id: string
  title: string
  description: string
  usage?: string
  target: 'plugin' | 'window'
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
}

export interface PluginViewDefinition {
  entry: string
  instances?: 'single' | 'multiple'
  width: number
  height: number
  minWidth: number
  minHeight: number
}

export interface GitBoardNodeData {
  [key: string]: unknown
  pluginId: string
  schemaVersion: number
  repoPath: string
  mountId: string | null
  graphLimit: number
}

export interface GitBoardCommit {
  commit: string
  shortCommit: string
  parents: string[]
  branch: string | null
  refs: string[]
  subject: string
  author: string | null
  authoredAt: string | null
}

export interface GitBoardStatus {
  repoPath: string
  branch: string | null
  head: string | null
  detached: boolean
  clean: boolean
  changedFileCount: number
  stagedFileCount: number
  unstagedFileCount: number
  untrackedFileCount: number
  ahead: number
  behind: number
  conflicts: number
}

export interface GitBoardSnapshot {
  status: GitBoardStatus
  commits: GitBoardCommit[]
  fetchedAt: string
}
