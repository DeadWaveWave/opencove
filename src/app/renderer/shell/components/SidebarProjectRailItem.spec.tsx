import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { resolveProjectAccent } from '../utils/projectAccent'
import { SidebarProjectRailItem } from './SidebarProjectRailItem'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

const workspace: WorkspaceState = {
  id: 'workspace-rail',
  name: 'infra-terraform-modules',
  iconId: 'database',
  path: '/tmp/infra',
  worktreesRoot: '',
  nodes: [],
  viewport: DEFAULT_WORKSPACE_VIEWPORT,
  isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  spaces: [],
  activeSpaceId: null,
  spaceArchiveRecords: [],
}

function renderItem(counts: { waiting?: number; working?: number } = {}) {
  return render(
    <SidebarProjectRailItem
      workspace={workspace}
      isActive
      isPreviewed={false}
      remote={null}
      waitingAgentCount={counts.waiting ?? 0}
      workingAgentCount={counts.working ?? 0}
      onPreview={() => undefined}
      onSelectWorkspace={() => undefined}
      onOpenProjectContextMenu={() => undefined}
    />,
  )
}

describe('SidebarProjectRailItem', () => {
  it('shows the project name under a tile in the project colour', () => {
    renderItem()
    const project = screen.getByTestId('workspace-item-workspace-rail')
    expect(project.querySelector('.workspace-project-rail__name')?.textContent).toBe(
      'infra-terraform-modules',
    )
    expect(
      project.querySelector('.workspace-project-rail__tile')?.getAttribute('data-cove-accent'),
    ).toBe(resolveProjectAccent('workspace-rail'))
    expect(project.getAttribute('title')).toBe('infra-terraform-modules')
  })

  it('counts waiting agents on the tile and names them for screen readers', () => {
    renderItem({ waiting: 120 })
    expect(screen.getByTestId('workspace-project-attention-workspace-rail').textContent).toBe('99+')
    expect(screen.getByTestId('workspace-item-workspace-rail').getAttribute('aria-label')).toBe(
      'infra-terraform-modules\n120 agents need input',
    )
  })

  it('marks a project whose agents are working', () => {
    const { rerender } = renderItem()
    expect(screen.queryByTestId('workspace-project-working-workspace-rail')).toBeNull()
    rerender(
      <SidebarProjectRailItem
        workspace={workspace}
        isActive={false}
        isPreviewed={false}
        remote={null}
        waitingAgentCount={0}
        workingAgentCount={2}
        onPreview={() => undefined}
        onSelectWorkspace={() => undefined}
        onOpenProjectContextMenu={() => undefined}
      />,
    )
    expect(screen.getByTestId('workspace-project-working-workspace-rail')).not.toBeNull()
    expect(screen.getByTestId('workspace-item-workspace-rail').getAttribute('aria-label')).toBe(
      'infra-terraform-modules\n2 agents working',
    )
  })
})
