import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import {
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../store/useAppStore'
import { Sidebar } from './Sidebar'

beforeEach(() => {
  useAppStore.setState({ agentSettings: DEFAULT_AGENT_SETTINGS })
})

it('retains project collapse after remount and saves a later explicit expansion', () => {
  const workspace: WorkspaceState = {
    id: 'project-a',
    name: 'Project A',
    path: '/tmp/project-a',
    worktreesRoot: '',
    nodes: [],
    spaces: [
      {
        id: 'space-a',
        name: 'Space A',
        directoryPath: '/tmp/project-a',
        targetMountId: null,
        nodeIds: [],
        rect: null,
        labelColor: null,
      },
    ],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: false,
  }
  const sidebar = (
    <Sidebar
      workspaces={[workspace]}
      activeWorkspaceId={workspace.id}
      persistNotice={null}
      onSelectWorkspace={vi.fn()}
      onSelectSpace={vi.fn()}
      onOpenProjectContextMenu={vi.fn()}
      onSelectAgentNode={vi.fn()}
      onReorderWorkspaces={vi.fn()}
    />
  )
  const first = render(sidebar)
  const toggle = () => screen.getByTestId('workspace-item-toggle-project-a')
  fireEvent.click(toggle())
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  first.unmount()
  render(sidebar)
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle())
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
  expect(useAppStore.getState().agentSettings).toMatchObject({ sidebarCollapsedWorkspaceIds: {} })
})
