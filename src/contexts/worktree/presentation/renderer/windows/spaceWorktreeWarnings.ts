import type { TranslateFn } from '@app/renderer/i18n'
import type { RemoveGitWorktreeResult } from '@shared/contracts/dto'

export function buildArchiveWarningMessage(
  result: RemoveGitWorktreeResult,
  t: TranslateFn,
): string | null {
  const warnings: string[] = []

  if (result.directoryCleanupError) {
    warnings.push(t('worktree.archiveDirectoryCleanupFailed'))
  }

  if (result.branchDeleteError) {
    warnings.push(t('worktree.archiveBranchDeleteFailed'))
  }

  return warnings.length > 0 ? warnings.join(' ') : null
}
