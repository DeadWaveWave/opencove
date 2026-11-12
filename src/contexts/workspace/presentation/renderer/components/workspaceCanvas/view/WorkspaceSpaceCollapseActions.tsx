import type { JSX } from 'react'
import { FoldIcon } from '@app/renderer/components/ui/pixelIcons'
import { useTranslation } from '@app/renderer/i18n'
import { useWorkspaceCollapse } from '../collapse/WorkspaceCollapseContext'

export function WorkspaceSpaceCollapseActions({ spaceId }: { spaceId: string }): JSX.Element {
  const { t } = useTranslation()
  const collapse = useWorkspaceCollapse()
  return (
    <span className="workspace-space-region__collapse-actions">
      <button
        type="button"
        className="workspace-space-region__control"
        data-cove-space-caption="collapse-arrange"
        data-testid={`workspace-space-collapse-arrange-${spaceId}`}
        title={t('spaceCollapse.collapseAndArrange')}
        aria-label={t('spaceCollapse.collapseAndArrange')}
        onClick={event => {
          event.stopPropagation()
          collapse.collapseAndArrange(spaceId)
        }}
      >
        <FoldIcon size={18} />
      </button>
    </span>
  )
}
