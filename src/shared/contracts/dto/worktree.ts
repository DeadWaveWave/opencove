import type { AgentProviderId } from './agent'
import type { AppErrorDescriptor } from './error'

export interface GitWorktreeInfo {
  path: string
  head: string | null
  branch: string | null
}

export interface ListGitBranchesInput {
  repoPath: string
}

export interface ListGitBranchesResult {
  current: string | null
  branches: string[]
}

export interface ListGitWorktreesInput {
  repoPath: string
}

export interface ListGitWorktreesResult {
  worktrees: GitWorktreeInfo[]
}

export interface GetGitStatusSummaryInput {
  repoPath: string
}

export interface GetGitStatusSummaryResult {
  changedFileCount: number
}

export type CreateGitWorktreeBranchMode =
  | { kind: 'new'; name: string; startPoint: string }
  | { kind: 'existing'; name: string }

export interface CreateGitWorktreeInput {
  repoPath: string
  worktreesRoot: string
  branchMode: CreateGitWorktreeBranchMode
}

export interface CreateGitWorktreeResult {
  worktree: GitWorktreeInfo
}

export interface RemoveGitWorktreeInput {
  repoPath: string
  worktreePath: string
  force?: boolean
  deleteBranch?: boolean
}

export interface RemoveGitWorktreeResult {
  deletedBranchName: string | null
  branchDeleteError: AppErrorDescriptor | null
}

export interface RenameGitBranchInput {
  repoPath: string
  worktreePath: string
  currentName: string
  nextName: string
}

export interface SuggestWorktreeNamesInput {
  provider: AgentProviderId
  cwd: string
  spaceName: string
  spaceNotes?: string | null
  tasks: Array<{
    title: string
    requirement: string
  }>
  model?: string | null
}

export interface SuggestWorktreeNamesResult {
  branchName: string
  worktreeName: string
  provider: AgentProviderId
  effectiveModel: string | null
}
