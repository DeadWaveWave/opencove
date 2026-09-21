import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { Sidebar } from './Sidebar'

vi.mock('../hooks/useWorkspaceMountSummaries', () => ({
  useWorkspaceMountDetails: () => ({
    remote: {
      summary: 'remote',
      remote: { endpointId: 'dev', displayName: 'Development', rootPath: '/srv/code' },
    },
  }),
}))

function project(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: '/tmp/private-project',
    worktreesRoot: '',
    nodes: [],
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 10, y: 20, zoom: 0.5 },
    isMinimapVisible: false,
  }
}

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props = {
    workspaces: [project('local'), project('remote')],
    activeWorkspaceId: 'local',
    persistNotice: null,
    onSelectWorkspace: vi.fn(),
    onSelectSpace: vi.fn(),
    onSelectProjectCanvas: vi.fn(),
    onSelectAgentNode: vi.fn(),
    onOpenProjectContextMenu: vi.fn(),
    onReorderWorkspaces: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<Sidebar {...props} />) }
}

describe('Sidebar navigation semantics', () => {
  it('previews a project without navigation and resets preview for an external switch', () => {
    const { props, rerender } = renderSidebar()
    fireEvent.pointerEnter(screen.getByTestId('workspace-item-remote'), { pointerType: 'mouse' })
    expect(screen.getByTestId('workspace-project-navigation-remote')).toBeTruthy()
    expect(screen.getByTestId('workspace-item-local').getAttribute('aria-current')).toBe('page')
    expect(props.onSelectWorkspace).not.toHaveBeenCalled()
    rerender(<Sidebar {...props} activeWorkspaceId="remote" />)
    fireEvent.pointerEnter(screen.getByTestId('workspace-item-local'), { pointerType: 'mouse' })
    expect(screen.getByTestId('workspace-project-navigation-local')).toBeTruthy()
    rerender(<Sidebar {...props} activeWorkspaceId="local" />)
    expect(screen.getByTestId('workspace-project-navigation-local')).toBeTruthy()
  })

  it('freezes the preview while a menu is open and omits the redundant project canvas entry', () => {
    const { props } = renderSidebar({ isMenuOpen: true })
    fireEvent.pointerEnter(screen.getByTestId('workspace-item-remote'), { pointerType: 'mouse' })
    expect(screen.queryByTestId('workspace-project-navigation-remote')).toBeNull()
    expect(screen.queryByTestId('workspace-space-root-local')).toBeNull()
    expect(props.onSelectProjectCanvas).not.toHaveBeenCalled()
    expect(props.onSelectWorkspace).not.toHaveBeenCalled()
    expect(screen.getByTestId('workspace-sidebar-navigation').textContent).not.toContain('/tmp/')
  })

  it('shows remote identity independently of the active project and opens location details', () => {
    const { props } = renderSidebar()
    expect(screen.queryByTestId('workspace-project-remote-local')).toBeNull()
    expect(screen.getByTestId('workspace-project-remote-remote')).toBeTruthy()
    fireEvent.pointerEnter(screen.getByTestId('workspace-item-remote'), { pointerType: 'mouse' })
    fireEvent.click(screen.getByTestId('workspace-sidebar-remote'))
    expect(within(screen.getByRole('note')).getByText('/srv/code')).toBeTruthy()
    expect(props.onSelectWorkspace).not.toHaveBeenCalled()
  })

  it('counts only agents waiting for user input, independently of group and own color', () => {
    const workspace = project('local')
    workspace.nodes = ['waiting', 'running'].map((status, index) => ({
      id: `agent-${index}`,
      position: { x: 0, y: 0 },
      data: {
        sessionId: '',
        title: `Agent ${index}`,
        kind: 'agent',
        width: 400,
        height: 300,
        status: status as 'waiting' | 'running',
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: null,
        labelColorOverride: index === 0 ? 'orange' : null,
        task: null,
        note: null,
        image: null,
        document: null,
        website: null,
        agent: {
          provider: 'codex',
          prompt: '',
          model: null,
          effectiveModel: null,
          launchMode: 'new',
          resumeSessionId: null,
          executionDirectory: '',
          expectedDirectory: null,
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: null,
        },
      },
    }))
    workspace.spaces = [
      {
        id: 'space',
        name: 'ui/chrome',
        directoryPath: '',
        targetMountId: null,
        labelColor: 'green',
        nodeIds: ['agent-0', 'agent-1'],
        rect: null,
      },
    ]
    renderSidebar({ workspaces: [workspace], currentNodeId: 'agent-0' })
    expect(screen.getByTestId('workspace-project-attention-local').textContent).toBe('1')
    expect(
      screen
        .getByTestId('workspace-agent-item-local-agent-0')
        .getAttribute('data-cove-label-color'),
    ).toBe('orange')
    expect(
      screen.getByTestId('workspace-agent-item-local-agent-0').getAttribute('aria-current'),
    ).toBe('location')
    expect(
      screen
        .getByTestId('workspace-agent-item-local-agent-0')
        .classList.contains('workspace-agent-item--current'),
    ).toBe(false)
    expect(
      screen
        .getByTestId('workspace-agent-item-local-agent-1')
        .hasAttribute('data-cove-label-color'),
    ).toBe(false)
    expect(
      screen.getByTestId('workspace-space-item-local-space').hasAttribute('aria-current'),
    ).toBe(false)
    expect(
      screen
        .getByTestId('workspace-space-item-local-space')
        .classList.contains('workspace-space-item--active'),
    ).toBe(false)
  })
})
