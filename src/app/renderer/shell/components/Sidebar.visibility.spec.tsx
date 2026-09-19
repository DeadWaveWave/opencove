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

function chooseFilter(name: string, option: string) {
  fireEvent.click(screen.getByTestId(`sidebar-filter-${name}-trigger`))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

beforeEach(() => {
  useAppStore.setState({
    workspaces: [workspace],
    agentSettings: DEFAULT_AGENT_SETTINGS,
    projectContextMenu: null,
  })
})

describe('Sidebar compact filters and temporary hiding', () => {
  it('hides through the existing context menu, restores directly and persists the filter across remount', () => {
    const rendered = render(<Harness />)
    fireEvent.contextMenu(screen.getByTestId('workspace-agent-item-project-codex'))
    fireEvent.click(screen.getByTestId('workspace-sidebar-visibility-action'))
    expect(screen.queryByTestId('workspace-agent-item-project-codex')).toBeNull()
    expect(screen.getByTestId('workspace-agent-item-project-claude')).toBeTruthy()
    expect(screen.getByTestId('workspace-sidebar-filter').title).toBe('1 hidden Agent needs input')
    fireEvent.click(screen.getByTestId('workspace-sidebar-filter'))
    const panel = screen.getByTestId('workspace-sidebar-filters')
    expect(within(panel).getAllByRole('button', { expanded: false })).toHaveLength(3)
    expect(within(panel).queryByRole('checkbox')).toBeNull()
    chooseFilter('visibility', 'Hidden only')
    expect(screen.getByTestId('workspace-space-item-project-space')).toBeTruthy()
    expect(screen.queryByTestId('workspace-agent-item-project-claude')).toBeNull()
    fireEvent.click(screen.getByTestId('workspace-agent-restore-project-codex'))
    expect(screen.queryByTestId('workspace-agent-item-project-codex')).toBeNull()
    expect(
      within(screen.getByTestId('workspace-sidebar-navigation')).getByRole('status').textContent,
    ).toContain('visible in Sidebar')
    expect(useAppStore.getState().agentSettings.sidebarView.hiddenAgentIds).toEqual({})
    rendered.unmount()
    render(<Harness />)
    fireEvent.click(screen.getByTestId('workspace-sidebar-filter'))
    expect(screen.getByTestId('sidebar-filter-visibility-trigger').textContent).toContain(
      'Hidden only',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByTestId('workspace-agent-item-project-codex')).toBeTruthy()
  })

  it('restores the hidden parent only and keeps its explicitly hidden Agent preference', () => {
    useAppStore.setState({
      agentSettings: {
        ...DEFAULT_AGENT_SETTINGS,
        sidebarView: {
          hiddenSpaceIds: { 'project:space': true },
          hiddenAgentIds: { 'project:codex': true },
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

  it('filters by actual provider/status, keeps disclosure unchanged and dismisses only the top dropdown on Escape', () => {
    useAppStore.setState({
      agentSettings: {
        ...DEFAULT_AGENT_SETTINGS,
        sidebarCollapsedSpaceGroupIds: { 'project:space': true },
      },
    })
    render(<Harness />)
    fireEvent.click(screen.getByTestId('workspace-sidebar-filter'))
    chooseFilter('status', 'Working')
    chooseFilter('provider', 'Claude Code')
    expect(
      screen.getByTestId('workspace-space-toggle-project-space').getAttribute('aria-expanded'),
    ).toBe('false')
    fireEvent.click(screen.getByTestId('sidebar-filter-visibility-trigger'))
    fireEvent.keyDown(screen.getByRole('option', { name: 'Not hidden' }), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByTestId('workspace-sidebar-filters')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('workspace-sidebar-filters')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('workspace-sidebar-filter'))
    fireEvent.click(screen.getByTestId('workspace-space-toggle-project-space'))
    expect(screen.getByTestId('workspace-agent-item-project-claude')).toBeTruthy()
    expect(screen.queryByTestId('workspace-agent-item-project-codex')).toBeNull()
  })
})
