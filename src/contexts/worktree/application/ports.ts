import type {
  CreateGitWorktreeInput,
  GetGitDefaultBranchInput,
  GetGitStatusSummaryInput,
  GetGitStatusSummaryResult,
  GetGitGraphInput,
  GetGitGraphResult,
  GitWorktreeInfo,
  ListGitBranchesInput,
  ListGitBranchesResult,
  ListGitWorktreesInput,
  ListGitWorktreesResult,
  RemoveGitWorktreeInput,
  RemoveGitWorktreeResult,
  RenameGitBranchInput,
  SuggestWorktreeNamesInput,
  SuggestWorktreeNamesResult,
} from '@shared/contracts/dto'

export interface GitWorktreePort {
  listBranches: (input: ListGitBranchesInput) => Promise<ListGitBranchesResult>
  listWorktrees: (input: ListGitWorktreesInput) => Promise<ListGitWorktreesResult>
  getStatusSummary: (input: GetGitStatusSummaryInput) => Promise<GetGitStatusSummaryResult>
  getGraph: (input: GetGitGraphInput) => Promise<GetGitGraphResult>
  getDefaultBranch: (input: GetGitDefaultBranchInput) => Promise<string | null>
  createWorktree: (input: CreateGitWorktreeInput) => Promise<GitWorktreeInfo>
  removeWorktree: (input: RemoveGitWorktreeInput) => Promise<RemoveGitWorktreeResult>
  renameBranch: (input: RenameGitBranchInput) => Promise<void>
  suggestNames: (input: SuggestWorktreeNamesInput) => Promise<SuggestWorktreeNamesResult>
}
