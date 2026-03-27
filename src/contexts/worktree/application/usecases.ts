import type {
  CreateGitWorktreeInput,
  CreateGitWorktreeResult,
  GetGitDefaultBranchInput,
  GetGitDefaultBranchResult,
  GetGitStatusSummaryInput,
  GetGitStatusSummaryResult,
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
import type { GitWorktreePort } from './ports'

export async function listGitBranchesUseCase(
  port: GitWorktreePort,
  input: ListGitBranchesInput,
): Promise<ListGitBranchesResult> {
  return await port.listBranches(input)
}

export async function listGitWorktreesUseCase(
  port: GitWorktreePort,
  input: ListGitWorktreesInput,
): Promise<ListGitWorktreesResult> {
  return await port.listWorktrees(input)
}

export async function getGitStatusSummaryUseCase(
  port: GitWorktreePort,
  input: GetGitStatusSummaryInput,
): Promise<GetGitStatusSummaryResult> {
  return await port.getStatusSummary(input)
}

export async function getGitDefaultBranchUseCase(
  port: GitWorktreePort,
  input: GetGitDefaultBranchInput,
): Promise<GetGitDefaultBranchResult> {
  const branch = await port.getDefaultBranch(input)
  return { branch }
}

export async function createGitWorktreeUseCase(
  port: GitWorktreePort,
  input: CreateGitWorktreeInput,
): Promise<CreateGitWorktreeResult> {
  const worktree = await port.createWorktree(input)
  return { worktree }
}

export async function removeGitWorktreeUseCase(
  port: GitWorktreePort,
  input: RemoveGitWorktreeInput,
): Promise<RemoveGitWorktreeResult> {
  return await port.removeWorktree(input)
}

export async function renameGitBranchUseCase(
  port: GitWorktreePort,
  input: RenameGitBranchInput,
): Promise<void> {
  await port.renameBranch(input)
}

export async function suggestWorktreeNamesUseCase(
  port: GitWorktreePort,
  input: SuggestWorktreeNamesInput,
): Promise<SuggestWorktreeNamesResult> {
  return await port.suggestNames(input)
}
