import type { JSX } from 'react'
import { ChevronDown, ChevronUp, PanelsTopLeft, Undo2 } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { useWorkspaceCollapse } from '../collapse/WorkspaceCollapseContext'

export function WorkspaceSpaceCollapseActions({ spaceId }: { spaceId: string }): JSX.Element {
  const { t } = useTranslation()
  const collapse = useWorkspaceCollapse()
  const isCollapsed = collapse.collapsedSpaceIds[spaceId] === true
  return (
    <span className="workspace-space-region__collapse-actions">
      {!isCollapsed ? (
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
          <PanelsTopLeft size={15} aria-hidden="true" />
        </button>
      ) : null}
      {collapse.canUndoArrange(spaceId) ? (
        <button
          type="button"
          className="workspace-space-region__control"
          data-cove-space-caption="undo-arrange"
          data-testid={`workspace-space-undo-arrange-${spaceId}`}
          title={t('spaceCollapse.undoArrange')}
          aria-label={t('spaceCollapse.undoArrange')}
          onClick={event => {
            event.stopPropagation()
            collapse.undoArrange(spaceId)
          }}
        >
          <Undo2 size={15} aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="workspace-space-region__control"
        data-cove-space-caption="collapse"
        data-testid={`workspace-space-collapse-${spaceId}`}
        title={t(isCollapsed ? 'spaceCollapse.expand' : 'spaceCollapse.collapse')}
        aria-label={t(isCollapsed ? 'spaceCollapse.expand' : 'spaceCollapse.collapse')}
        aria-expanded={!isCollapsed}
        onClick={event => {
          event.stopPropagation()
          collapse.toggleSpace(spaceId)
        }}
      >
        {isCollapsed ? (
          <ChevronDown size={15} aria-hidden="true" />
        ) : (
          <ChevronUp size={15} aria-hidden="true" />
        )}
      </button>
    </span>
  )
}
