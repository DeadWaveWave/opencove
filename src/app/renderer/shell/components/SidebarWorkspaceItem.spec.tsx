import { fireEvent, render, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../store/useAppStore'
import type { SidebarSpaceGroupModel } from '../utils/sidebarTree'
import { SidebarWorkspaceNavigation, SpaceItemOverlay } from './SidebarWorkspaceItem'

function createPinnedNavigationTree(): {
  workspace: WorkspaceState
  group: SidebarSpaceGroupModel
} {
  const workspace = {
    id: 'workspace-a',
    name: 'Project A',
    path: '/tmp/workspace-a',
    worktreesRoot: '',
    nodes: [],
    spaces: [
      {
        id: 'space-a',
        name: 'Space A',
        directoryPath: '/tmp/workspace-a',
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: null,
        pinned: true,
      },
    ],
    activeSpaceId: 'space-a',
  } as unknown as WorkspaceState
  const space = workspace.spaces[0]
  const group: SidebarSpaceGroupModel = {
    id: 'space-a',
    kind: 'space',
    name: 'Space A',
    labelColor: null,
    space,
    agents: [],
  }
  return { workspace, group }
}

describe('SidebarWorkspaceItem', () => {
  beforeEach(() => {
    useAppStore.setState({ workspaces: [] })
  })

  it('renders a leaf space icon without disclosure semantics', () => {
    const leafGroup: SidebarSpaceGroupModel = {
      id: 'leaf-space',
      kind: 'space',
      name: 'Leaf space',
      labelColor: 'orange',
      space: {
        id: 'leaf-space',
        name: 'Leaf space',
        directoryPath: '/tmp/leaf-space',
        targetMountId: null,
        labelColor: 'orange',
        nodeIds: [],
        rect: null,
      },
      agents: [],
    }

    const { container } = render(<SpaceItemOverlay group={leafGroup} isExpanded />)
    const spaceItem = container.querySelector('.workspace-space-item')
    const railMarker = spaceItem?.querySelector('svg')

    expect(railMarker).not.toBeNull()
    expect(railMarker?.getAttribute('aria-hidden')).toBe('true')
    expect(railMarker?.classList.contains('workspace-tree-triangle')).toBe(false)
    expect(spaceItem?.querySelector('.workspace-space-item__toggle')).toBeNull()
    expect(spaceItem?.querySelector('.workspace-space-item__chevron')).toBeNull()
    expect(spaceItem?.getAttribute('aria-expanded')).toBeNull()
  })

  it('shows a pinned space unpin control on the sidebar row', () => {
    const { workspace, group } = createPinnedNavigationTree()
    useAppStore.setState({ workspaces: [workspace] })

    render(
      <DndContext>
        <SidebarWorkspaceNavigation
          tree={{
            workspace,
            spaceGroups: [group],
            projectRootGroup: {
              id: 'project-root',
              kind: 'project-root',
              name: 'Project canvas',
              labelColor: null,
              space: null,
              agents: [],
            },
            agentCount: 0,
            workingAgentCount: 0,
          }}
          isActive
          collapsedSpaceGroupIds={{}}
          onToggleSpaceGroup={vi.fn()}
          onSelectProjectCanvas={vi.fn()}
          onSelectSpace={vi.fn()}
          onOpenProjectContextMenu={vi.fn()}
          onSelectAgentNode={vi.fn()}
        />
      </DndContext>,
    )

    const unpin = screen.getByTestId('workspace-space-unpin-workspace-a-space-a')
    expect(unpin.getAttribute('aria-label')).toBe('Unpin space')

    fireEvent.click(unpin)

    expect(useAppStore.getState().workspaces[0]?.spaces[0]?.pinned).toBe(false)
  })

  describe('Space cards', () => {
    const original = window.opencoveApi
    afterEach(() => {
      window.opencoveApi = original
    })

    it("names the branch of a Space's own worktree, and none for the project's checkout", async () => {
      const listWorktrees = vi.fn(async () => ({
        worktrees: [
          { path: '/tmp/branch-project', branch: 'main', head: 'a'.repeat(40) },
          { path: '/tmp/branch-project/.worktrees/review', branch: 'pr/431', head: 'b'.repeat(40) },
        ],
      }))
      window.opencoveApi = {
        ...original,
        worktree: { ...original?.worktree, listWorktrees },
      } as typeof window.opencoveApi
      const space = (id: string, directoryPath: string) => ({
        id,
        name: id,
        directoryPath,
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: { x: 0, y: 0, width: 400, height: 300 },
      })
      const workspace = {
        id: 'branch-project',
        name: 'Branch project',
        path: '/tmp/branch-project',
        worktreesRoot: '',
        nodes: [],
        spaces: [
          space('build', '/tmp/branch-project'),
          space('review', '/tmp/branch-project/.worktrees/review'),
        ],
        activeSpaceId: null,
      } as unknown as WorkspaceState
      const group = (index: number): SidebarSpaceGroupModel => ({
        id: workspace.spaces[index]!.id,
        kind: 'space',
        name: workspace.spaces[index]!.name,
        labelColor: null,
        space: workspace.spaces[index]!,
        agents: [],
      })
      useAppStore.setState({ workspaces: [workspace] })

      render(
        <DndContext>
          <SidebarWorkspaceNavigation
            tree={{
              workspace,
              spaceGroups: [group(0), group(1)],
              projectRootGroup: {
                id: 'project-root',
                kind: 'project-root',
                name: 'Project canvas',
                labelColor: null,
                space: null,
                agents: [],
              },
              agentCount: 0,
              workingAgentCount: 0,
            }}
            isActive
            collapsedSpaceGroupIds={{}}
            onToggleSpaceGroup={vi.fn()}
            onSelectProjectCanvas={vi.fn()}
            onSelectSpace={vi.fn()}
            onOpenProjectContextMenu={vi.fn()}
            onSelectAgentNode={vi.fn()}
          />
        </DndContext>,
      )

      const review = screen.getByTestId('workspace-space-item-branch-project-review')
      expect(await within(review).findByText('pr/431')).toBeTruthy()
      const build = screen.getByTestId('workspace-space-item-branch-project-build')
      expect(build.querySelector('.workspace-space-item__meta-branch')).toBeNull()
      // Two cards, one repository: listed once.
      expect(listWorktrees).toHaveBeenCalledTimes(1)
      expect(listWorktrees).toHaveBeenCalledWith({ repoPath: '/tmp/branch-project' })
    })
  })
})
