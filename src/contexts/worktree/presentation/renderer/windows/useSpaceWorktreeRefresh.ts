import { useCallback } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { GitWorktreeInfo } from '@shared/contracts/dto'
import { toErrorMessage } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'
import { getWorktreeApiMethod } from './spaceWorktree.shared'

export function useSpaceWorktreeRefresh({
  workspacePath,
  statusPath,
  setIsLoading,
  setError,
  setBranches,
  setCurrentBranch,
  setChangedFileCount,
  setWorktrees,
  setExistingBranchName,
  setStartPoint,
}: {
  workspacePath: string
  statusPath: string
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setBranches: React.Dispatch<React.SetStateAction<string[]>>
  setCurrentBranch: React.Dispatch<React.SetStateAction<string | null>>
  setChangedFileCount: React.Dispatch<React.SetStateAction<number>>
  setWorktrees: React.Dispatch<React.SetStateAction<GitWorktreeInfo[]>>
  setExistingBranchName: React.Dispatch<React.SetStateAction<string>>
  setStartPoint: React.Dispatch<React.SetStateAction<string>>
}): () => Promise<void> {
  const { t } = useTranslation()

  return useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const listBranches = getWorktreeApiMethod('listBranches', t)
      const listWorktrees = getWorktreeApiMethod('listWorktrees', t)
      const statusSummary = getWorktreeApiMethod('statusSummary', t)
      const [branchesResult, worktreesResult, statusSummaryResult] = await Promise.all([
        listBranches({ repoPath: workspacePath }),
        listWorktrees({ repoPath: workspacePath }),
        statusSummary({ repoPath: statusPath }),
      ])

      setBranches(branchesResult.branches)
      setCurrentBranch(branchesResult.current)
      setChangedFileCount(statusSummaryResult.changedFileCount)
      setWorktrees(worktreesResult.worktrees)

      setExistingBranchName(previous =>
        previous.trim().length > 0
          ? previous
          : (branchesResult.current ?? branchesResult.branches[0] ?? ''),
      )

      setStartPoint(previous => {
        if (previous !== 'HEAD') {
          return previous
        }

        return branchesResult.current ?? previous
      })
    } catch (fetchError) {
      setError(t('worktree.refreshFailed', { message: toErrorMessage(fetchError) }))
    } finally {
      setIsLoading(false)
    }
  }, [
    setBranches,
    setChangedFileCount,
    setCurrentBranch,
    setError,
    setExistingBranchName,
    setIsLoading,
    setStartPoint,
    t,
    setWorktrees,
    statusPath,
    workspacePath,
  ])
}
