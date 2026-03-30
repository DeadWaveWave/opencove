import { toErrorMessage } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'
import { OpenCoveAppError } from '@shared/errors/appError'
import type { TranslateFn } from '@app/renderer/i18n'

export function toSpaceWorktreeErrorMessage(error: unknown, t: TranslateFn): string {
  if (error instanceof OpenCoveAppError && error.code === 'worktree.remove_uncommitted_changes') {
    return t('worktree.archiveUncommittedChangesWarning')
  }

  if (error instanceof OpenCoveAppError && error.code === 'worktree.repo_has_no_commits') {
    return t('worktree.initialCommitRequired')
  }

  return toErrorMessage(error)
}
