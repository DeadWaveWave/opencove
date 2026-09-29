export type PluginNodeKind = 'git-board'

export type PluginIconDeclaration =
  | { type: 'builtin'; name: 'git-branch' | 'puzzle' }
  | { type: 'asset'; path: string; light?: string; dark?: string }

export interface PluginManifest {
  id: string
  version: string
  displayName: string
  description: string
  icon?: PluginIconDeclaration
  nodeKinds: readonly PluginNodeKind[]
  actionBar: boolean
  contextMenu: boolean
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
