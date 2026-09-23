import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { buildSidebarProjectTree, SIDEBAR_UNASSIGNED_SPACE_GROUP_ID } from '../utils/sidebarTree'
import { createAgentSortableId } from './SidebarDnd'
import { SidebarWorkspaceNavigation } from './SidebarWorkspaceItem'

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: ({ id, disabled }: { id: string; disabled: boolean }) => ({
    attributes: { 'data-sortable-id': id },
    listeners: disabled ? undefined : { 'data-drag-listener': 'true' },
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}))

function makeWorkspace(id: string, agentIds: string[]): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: false,
    nodes: agentIds.map(nodeId => ({
      id: nodeId,
      position: { x: 0, y: 0 },
      data: {
        sessionId: nodeId,
        title: nodeId,
        kind: 'agent',
        width: 400,
        height: 300,
        status: 'standby',
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: null,
        agent: null,
        task: null,
        note: null,
        image: null,
        document: null,
        website: null,
      },
    })),
  }
}

function Navigation({ workspace }: { workspace: WorkspaceState }) {
  return (
    <SidebarWorkspaceNavigation
      tree={buildSidebarProjectTree(workspace)}
      isActive
      collapsedSpaceGroupIds={{}}
      onToggleSpaceGroup={vi.fn()}
      onSelectProjectCanvas={vi.fn()}
      onSelectSpace={vi.fn()}
      onOpenProjectContextMenu={vi.fn()}
      onSelectAgentNode={vi.fn()}
    />
  )
}

describe('root Agent sorting without a visible root group', () => {
  it('binds multiple root Agents to their existing project-scoped sortable group', () => {
    const { container } = render(
      <>
        <Navigation workspace={makeWorkspace('alpha', ['first', 'second'])} />
        <Navigation workspace={makeWorkspace('beta', ['first', 'second'])} />
      </>,
    )
    for (const workspaceId of ['alpha', 'beta']) {
      for (const nodeId of ['first', 'second']) {
        const row = screen.getByTestId(`workspace-agent-item-${workspaceId}-${nodeId}`)
        expect(row).toHaveAttribute('data-drag-listener', 'true')
        expect(row).toHaveAttribute(
          'data-sortable-id',
          createAgentSortableId(workspaceId, SIDEBAR_UNASSIGNED_SPACE_GROUP_ID, nodeId),
        )
      }
    }
    expect(container.querySelector('.workspace-space-group--root')).toBeNull()
    expect(container.querySelector('[data-testid^="workspace-space-root-"]')).toBeNull()
  })

  it('leaves one root Agent as an ordinary clickable row', () => {
    render(<Navigation workspace={makeWorkspace('single', ['only'])} />)
    const row = screen.getByTestId('workspace-agent-item-single-only')
    expect(row).not.toHaveAttribute('data-sortable-id')
    expect(row).not.toHaveAttribute('data-drag-listener')
  })
})
