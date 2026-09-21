import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../store/useAppStore'
import { Sidebar } from './Sidebar'
import { ProjectContextMenu } from './ProjectContextMenu'

const workspace: WorkspaceState = {
  id: 'project',
  name: 'Project',
  path: '/tmp/project',
  worktreesRoot: '',
  nodes: ['codex', 'claude'].map(id => ({
    id,
    position: { x: 0, y: 0 },
    data: {
      sessionId: id,
      title: id,
      width: 400,
      height: 300,
      kind: 'agent',
      status: id === 'codex' ? 'waiting' : 'running',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
      agent: {
        provider: id === 'codex' ? 'codex' : 'claude-code',
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'new',
        resumeSessionId: null,
        executionDirectory: '/tmp/project',
        expectedDirectory: '/tmp/project',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
    },
  })),
  spaces: [
    {
      id: 'space',
      name: 'Space',
      directoryPath: '/tmp/project',
      targetMountId: null,
      nodeIds: ['codex', 'claude'],
      rect: null,
      labelColor: null,
    },
  ],
  activeSpaceId: null,
  spaceArchiveRecords: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  isMinimapVisible: false,
}

function Harness() {
  const menu = useAppStore(state => state.projectContextMenu)
  return (
    <>
      <Sidebar
        workspaces={[workspace]}
        activeWorkspaceId="project"
        persistNotice={null}
        onSelectWorkspace={vi.fn()}
        onSelectSpace={vi.fn()}
        onSelectAgentNode={vi.fn()}
        onOpenProjectContextMenu={useAppStore.getState().setProjectContextMenu}
        onReorderWorkspaces={vi.fn()}
      />
      {menu ? (
        <ProjectContextMenu
          workspaces={[workspace]}
          {...menu}
          onRequestManageMounts={vi.fn()}
          onRequestOpenInFileManager={vi.fn()}
          onRequestRemove={vi.fn()}
        />
      ) : null}
    </>
  )
}

beforeEach(() => {
  useAppStore.setState({
    workspaces: [workspace],
    agentSettings: DEFAULT_AGENT_SETTINGS,
    projectContextMenu: null,
  })
})

describe('Sidebar view modes and temporary hiding', () => {
  it('hides through the context menu, restores directly and cycles view modes', () => {
    const rendered = render(<Harness />)
    fireEvent.contextMenu(screen.getByTestId('workspace-agent-item-project-codex'))
    fireEvent.click(screen.getByTestId('workspace-sidebar-visibility-action'))
    expect(screen.queryByTestId('workspace-agent-item-project-codex')).toBeNull()
    expect(screen.getByTestId('workspace-agent-item-project-claude')).toBeTruthy()
    const mode = screen.getByTestId('workspace-sidebar-view-mode')
    expect(mode.getAttribute('data-mode')).toBe('normal')
    fireEvent.click(mode)
    expect(mode.getAttribute('data-mode')).toBe('all')
    expect(screen.getByTestId('workspace-space-item-project-space')).toBeTruthy()
    expect(screen.getByTestId('workspace-agent-item-project-claude')).toBeTruthy()
    fireEvent.click(screen.getByTestId('workspace-agent-restore-project-codex'))
    expect(screen.getByTestId('workspace-agent-item-project-codex')).toBeTruthy()
    expect(
      within(screen.getByTestId('workspace-sidebar-navigation')).getByRole('status').textContent,
    ).toContain('visible in Sidebar')
    expect(useAppStore.getState().agentSettings.sidebarView.hiddenAgentIds).toEqual({})
    rendered.unmount()
    render(<Harness />)
    expect(screen.getByTestId('workspace-sidebar-view-mode').getAttribute('data-mode')).toBe('all')
  })

  it('restores the hidden parent only and keeps its explicitly hidden Agent preference', () => {
    useAppStore.setState({
      agentSettings: {
        ...DEFAULT_AGENT_SETTINGS,
        sidebarView: {
          hiddenSpaceIds: { 'project:space': true },
          hiddenAgentIds: { 'project:codex': true },
          mode: 'all',
          pinnedAgentIds: {},
          filters: { status: 'all', provider: 'all', visibility: 'all' },
        },
      },
    })
    render(<Harness />)
    expect(screen.getByTestId('workspace-space-restore-project-space')).toBeTruthy()
    expect(screen.queryByTestId('workspace-agent-restore-project-codex')).toBeNull()
    expect(screen.queryByTestId('workspace-agent-more-project-codex')).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('workspace-agent-item-project-codex'))
    expect(screen.queryByTestId('workspace-sidebar-visibility-action')).toBeNull()
    fireEvent.click(screen.getByTestId('workspace-space-restore-project-space'))
    expect(screen.getByTestId('workspace-agent-restore-project-codex')).toBeTruthy()
    expect(screen.getByTestId('workspace-agent-more-project-claude')).toBeTruthy()
    expect(useAppStore.getState().agentSettings.sidebarView.hiddenAgentIds).toEqual({
      'project:codex': true,
    })
  })

  it('focus mode keeps only pinned Agents and their Space while preserving disclosure state', () => {
    useAppStore.setState({
      agentSettings: {
        ...DEFAULT_AGENT_SETTINGS,
        sidebarCollapsedSpaceGroupIds: { 'project:space': true },
      },
    })
    render(<Harness />)
    fireEvent.click(screen.getByTestId('workspace-space-toggle-project-space'))
    fireEvent.contextMenu(screen.getByTestId('workspace-agent-item-project-claude'))
    fireEvent.click(screen.getByTestId('workspace-agent-context-pin-claude'))
    const mode = screen.getByTestId('workspace-sidebar-view-mode')
    fireEvent.click(mode)
    fireEvent.click(mode)
    expect(mode.getAttribute('data-mode')).toBe('focus')
    expect(
      screen.getByTestId('workspace-space-toggle-project-space').getAttribute('aria-expanded'),
    ).toBe('true')
    expect(screen.getByTestId('workspace-agent-item-project-claude')).toBeTruthy()
    expect(screen.queryByTestId('workspace-agent-item-project-codex')).toBeNull()
  })

  it('shows a pinned Agent unpin control on hoverable rows', () => {
    render(<Harness />)

    fireEvent.contextMenu(screen.getByTestId('workspace-agent-item-project-claude'))
    fireEvent.click(screen.getByTestId('workspace-agent-context-pin-claude'))

    const unpin = screen.getByTestId('workspace-agent-unpin-project-claude')
    expect(unpin.getAttribute('aria-label')).toBe('Unpin Agent')

    fireEvent.click(unpin)

    expect(
      useAppStore.getState().agentSettings.sidebarView.pinnedAgentIds?.['project:claude'],
    ).not.toBe(true)
    expect(screen.queryByTestId('workspace-agent-unpin-project-claude')).toBeNull()
  })
})
