import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import {
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../store/useAppStore'
import { Sidebar, type SidebarVariant } from './Sidebar'

beforeEach(() => {
  useAppStore.setState({ agentSettings: DEFAULT_AGENT_SETTINGS })
})

function createWorkspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    nodes: ['root', 'space'].map(group => ({
      id: `${id}-${group}-agent`,
      position: { x: 0, y: 0 },
      data: {
        sessionId: `${id}-${group}-session`,
        title: `${id} ${group} agent`,
        width: 320,
        height: 240,
        kind: 'agent',
        status: 'stopped',
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: null,
        agent: {
          provider: 'codex',
          prompt: 'Test',
          model: null,
          effectiveModel: null,
          launchMode: 'new',
          resumeSessionId: null,
          executionDirectory: `/tmp/${id}`,
          expectedDirectory: `/tmp/${id}`,
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: null,
        },
        task: null,
        note: null,
        image: null,
        document: null,
        website: null,
      },
    })),
    spaces: [
      {
        id: 'shared-space',
        name: 'Shared Space',
        directoryPath: `/tmp/${id}`,
        targetMountId: null,
        nodeIds: [`${id}-space-agent`],
        rect: null,
        labelColor: null,
      },
    ],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: false,
  }
}

const workspaces = [createWorkspace('project-a'), createWorkspace('project-b')]

function SidebarHarness({ variant = 'docked' }: { variant?: SidebarVariant }) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('project-a')
  return (
    <Sidebar
      variant={variant}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      persistNotice={null}
      onSelectWorkspace={setActiveWorkspaceId}
      onSelectSpace={vi.fn()}
      onOpenProjectContextMenu={vi.fn()}
      onSelectAgentNode={vi.fn()}
      onReorderWorkspaces={vi.fn()}
    />
  )
}

function toggle(projectId: string) {
  return screen.getByTestId(`workspace-space-toggle-${projectId}-shared-space`)
}

function expectSpace(projectId: string, expanded: boolean) {
  expect(toggle(projectId).getAttribute('aria-expanded')).toBe(String(expanded))
  const agent = screen.queryByTestId(`workspace-agent-item-${projectId}-${projectId}-space-agent`)
  if (expanded) {
    expect(agent).not.toBeNull()
  } else {
    expect(agent).toBeNull()
  }
  expect(
    screen.getByTestId(`workspace-agent-item-${projectId}-${projectId}-root-agent`),
  ).toBeTruthy()
  expect(screen.queryByTestId(`workspace-space-toggle-${projectId}-project-root`)).toBeNull()
}

it('persists Space disclosure independently across projects, remounts and rail transitions', () => {
  const first = render(<SidebarHarness />)
  expectSpace('project-a', true)
  fireEvent.click(toggle('project-a'))
  expect(useAppStore.getState().agentSettings.sidebarCollapsedSpaceGroupIds).toEqual({
    'project-a:shared-space': true,
  })

  fireEvent.click(screen.getByTestId('workspace-item-project-b'))
  expectSpace('project-b', true)
  fireEvent.click(toggle('project-b'))
  fireEvent.click(screen.getByTestId('workspace-item-project-a'))
  expectSpace('project-a', false)
  first.unmount()

  const second = render(<SidebarHarness />)
  expectSpace('project-a', false)
  second.rerender(<SidebarHarness variant="rail" />)
  expect(screen.queryByTestId('workspace-sidebar-navigation')).toBeNull()
  second.rerender(<SidebarHarness />)
  expectSpace('project-a', false)

  fireEvent.click(toggle('project-a'))
  expectSpace('project-a', true)
  expect(useAppStore.getState().agentSettings.sidebarCollapsedSpaceGroupIds).toEqual({
    'project-b:shared-space': true,
  })
  fireEvent.click(screen.getByTestId('workspace-item-project-b'))
  expectSpace('project-b', false)
  fireEvent.click(toggle('project-b'))
  expectSpace('project-b', true)
  expect(useAppStore.getState().agentSettings.sidebarCollapsedSpaceGroupIds).toEqual({})
})

it('keeps root agents directly visible when old project-canvas disclosure settings are restored', () => {
  useAppStore.setState({
    agentSettings: {
      ...DEFAULT_AGENT_SETTINGS,
      sidebarCollapsedWorkspaceIds: { 'project-a': true },
      sidebarCollapsedSpaceGroupIds: { 'project-a:project-root': true },
    },
  })
  const first = render(<SidebarHarness />)
  expectSpace('project-a', true)
  fireEvent.click(toggle('project-a'))
  expectSpace('project-a', false)
  first.unmount()

  render(<SidebarHarness />)
  expectSpace('project-a', false)
  expect(useAppStore.getState().agentSettings).toMatchObject({
    sidebarCollapsedWorkspaceIds: { 'project-a': true },
    sidebarCollapsedSpaceGroupIds: {
      'project-a:project-root': true,
      'project-a:shared-space': true,
    },
  })
})
