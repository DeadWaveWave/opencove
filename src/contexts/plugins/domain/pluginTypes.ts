export type PluginNodeKind = 'git-board'

export interface PluginManifest {
  id: string
  version: string
  displayName: string
  description: string
  nodeKinds: readonly PluginNodeKind[]
  actionBar: boolean
  contextMenu: boolean
}

export interface GitBoardNodeData {
  pluginId: 'git-board'
  schemaVersion: 1
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
