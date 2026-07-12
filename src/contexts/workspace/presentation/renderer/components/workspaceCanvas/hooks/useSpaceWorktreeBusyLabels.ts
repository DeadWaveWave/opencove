import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { SpaceWorktreeOperationState } from '../types'

export function useSpaceWorktreeBusyLabels(
  operations: SpaceWorktreeOperationState[],
): ReadonlyMap<string, string> {
  const { t } = useTranslation()

  return React.useMemo(() => {
    const labels = new Map<string, string>()
    for (const operation of operations) {
      if (operation.phase !== 'running') {
        continue
      }

      labels.set(
        operation.spaceId,
        operation.initialViewMode === 'archive'
          ? t('worktree.archivingSpace')
          : t('worktree.creatingWorktree'),
      )
    }
    return labels
  }, [operations, t])
}
