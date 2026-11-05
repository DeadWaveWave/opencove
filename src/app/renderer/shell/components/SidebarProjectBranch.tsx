import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { Tooltip } from '@app/renderer/components/ui/Tooltip'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { resolveProjectBranch } from '@contexts/workspace/presentation/renderer/worktreeInfo/spaceBranch'
import { useProjectWorktrees } from '@contexts/workspace/presentation/renderer/worktreeInfo/useProjectWorktrees'

/** The branch the project's checkout is on, beside its name (Tide prototype: "opencove feat/jwt"). */
export function SidebarProjectBranch({
  workspace,
}: {
  workspace: WorkspaceState
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const branch = resolveProjectBranch(useProjectWorktrees(workspace), workspace.path)
  if (!branch) {
    return null
  }
  return (
    <Tooltip content={branch.title} describe={false}>
      <span
        className="workspace-sidebar__project-branch"
        data-testid={`workspace-project-branch-${workspace.id}`}
      >
        {branch.kind === 'detached' ? `${t('worktree.detached')} ${branch.value}` : branch.value}
      </span>
    </Tooltip>
  )
}
