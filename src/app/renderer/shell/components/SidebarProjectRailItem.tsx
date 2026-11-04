import React from 'react'
import { Server } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { ProjectContextMenuState } from '../types'
import { ProjectTile } from './ProjectTile'
import { sidebarSortableTransition } from './SidebarDnd'
import type { WorkspaceMountDetails } from '../hooks/useWorkspaceMountSummaries'

export function SidebarProjectRailItem({
  workspace,
  isActive,
  isPreviewed,
  remote,
  waitingAgentCount,
  workingAgentCount,
  onPreview,
  onProjectPointerEnter,
  onSelectWorkspace,
  onOpenProjectContextMenu,
}: {
  workspace: WorkspaceState
  isActive: boolean
  isPreviewed: boolean
  remote: WorkspaceMountDetails['remote']
  waitingAgentCount: number
  workingAgentCount: number
  onPreview: (workspaceId: string) => void
  onProjectPointerEnter?: React.PointerEventHandler<HTMLElement>
  onSelectWorkspace: (workspaceId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const details = [
    workspace.name,
    remote ? `${t('sidebar.remoteProject')}: ${remote.displayName}\n${remote.rootPath}` : '',
    waitingAgentCount ? t('sidebar.agentsNeedInput', { count: waitingAgentCount }) : '',
    workingAgentCount ? t('sidebar.agentsWorking', { count: workingAgentCount }) : '',
  ]
    .filter(Boolean)
    .join('\n')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.id,
    transition: sidebarSortableTransition,
    data: { kind: 'project', workspaceId: workspace.id },
  })
  const openMenu = (x: number, y: number): void => {
    onOpenProjectContextMenu({
      workspaceId: workspace.id,
      x,
      y,
      target: { kind: 'project', workspaceId: workspace.id },
    })
  }

  return (
    <div
      ref={setNodeRef}
      className={`workspace-item-group workspace-project-rail__item${isActive ? ' workspace-project-rail__item--active' : ''}${isPreviewed ? ' workspace-project-rail__item--previewed' : ''}${isDragging ? ' workspace-item-group--dragging' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      onPointerEnter={event => {
        if (event.pointerType !== 'touch') {
          onProjectPointerEnter?.(event)
          onPreview(workspace.id)
        }
      }}
    >
      <button
        type="button"
        data-cove-part="sidebar-project"
        className={`workspace-item workspace-project-rail__project${isActive ? ' workspace-item--active' : ''}`}
        data-testid={`workspace-item-${workspace.id}`}
        aria-label={details}
        aria-current={isActive ? 'page' : undefined}
        title={details}
        {...attributes}
        {...listeners}
        onClick={() => onSelectWorkspace(workspace.id)}
        onContextMenu={event => {
          event.preventDefault()
          openMenu(event.clientX, event.clientY)
        }}
      >
        <ProjectTile
          workspaceId={workspace.id}
          iconId={workspace.iconId}
          isExpanded={isActive}
          className="workspace-project-rail__tile"
          iconClassName="workspace-item__folder-icon"
        >
          {workingAgentCount > 0 ? (
            <span
              className="workspace-project-rail__working"
              data-testid={`workspace-project-working-${workspace.id}`}
              aria-hidden="true"
            >
              <i />
              <i />
              <i />
            </span>
          ) : null}
          {waitingAgentCount > 0 ? (
            <span
              className="workspace-project-rail__attention"
              data-testid={`workspace-project-attention-${workspace.id}`}
              aria-hidden="true"
            >
              {waitingAgentCount > 99 ? '99+' : waitingAgentCount}
            </span>
          ) : null}
          {remote ? (
            <span
              className="workspace-project-rail__remote"
              data-testid={`workspace-project-remote-${workspace.id}`}
              aria-hidden="true"
            >
              <Server size={10} />
            </span>
          ) : null}
        </ProjectTile>
        <span className="workspace-item__name workspace-project-rail__name" aria-hidden="true">
          {workspace.name}
        </span>
      </button>
    </div>
  )
}
