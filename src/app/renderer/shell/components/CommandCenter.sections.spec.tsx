import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceNodeKind,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { useAgentWaitingSinceStore } from '../hooks/useAgentWaitingSince'
import { CommandCenter } from './CommandCenter'

vi.mock('../hooks/useWorkspaceMountSummaries', () => ({ useWorkspaceMountDetails: () => ({}) }))

function node(
  id: string,
  kind: WorkspaceNodeKind,
  title: string,
  status: TerminalNodeData['status'] = null,
): Node<TerminalNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { kind, title, status, width: 300, height: 200, agent: null },
  } as Node<TerminalNodeData>
}

const workspace: WorkspaceState = {
  id: 'core',
  name: 'OpenCove',
  iconId: 'code',
  path: '/tmp/core',
  worktreesRoot: '',
  nodes: [
    node('agent-wait', 'agent', 'Fix flaky E2E', 'waiting'),
    node('agent-run', 'agent', 'Refactor auth', 'running'),
    node('term', 'terminal', 'pnpm test --watch'),
    node('notes', 'note', 'Release notes'),
  ],
  spaces: [
    {
      id: 'release',
      name: 'release-0.5',
      labelColor: null,
      directoryPath: '/tmp/core',
      targetMountId: null,
      nodeIds: ['notes'],
      rect: null,
    },
  ],
  activeSpaceId: null,
  spaceArchiveRecords: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  isMinimapVisible: false,
}

function renderCommandCenter(onSelectNode = vi.fn()) {
  render(
    <CommandCenter
      isOpen
      activeWorkspace={workspace}
      workspaces={[workspace]}
      isPrimarySidebarCollapsed={false}
      onClose={() => undefined}
      onOpenSettings={() => undefined}
      onOpenWorkspaceSearch={() => undefined}
      onOpenSpaceArchives={() => undefined}
      onTogglePrimarySidebar={() => undefined}
      onAddWorkspace={() => undefined}
      onSelectWorkspace={() => undefined}
      onSelectSpace={() => undefined}
      onSelectNode={onSelectNode}
    />,
  )
  return onSelectNode
}

afterEach(() => {
  useAgentWaitingSinceStore.setState({ observations: new Map() })
})

describe('Command Center sections', () => {
  it('pins agents waiting for you above everything else', () => {
    renderCommandCenter()
    const options = screen.getAllByRole('option')
    expect(options[0]?.getAttribute('data-testid')).toBe(
      'command-center-item-needs-you:core:agent-wait',
    )
    expect(options[0]?.textContent).toContain('OpenCove · Project canvas')
    expect(options[0]?.getAttribute('data-tone')).toBe('waiting')
    const pill = options[0]?.querySelector('[data-cove-part="status-pill"]')
    expect(pill?.getAttribute('data-tone')).toBe('waiting')
    expect(pill?.textContent).toBe('Waiting')
    expect(
      options[0]?.querySelector('[data-cove-part="kind-tile"]')?.getAttribute('data-kind'),
    ).toBe('ai')
  })

  it('lists the current project windows on one line with their Space and flies to the one chosen', () => {
    const onSelectNode = renderCommandCenter()
    expect(screen.queryByTestId('command-center-item-window:agent-wait')).toBeNull()
    const notes = screen.getByTestId('command-center-item-window:notes')
    const term = screen.getByTestId('command-center-item-window:term')
    expect(notes.querySelector('.command-center__item-trailing')?.textContent).toBe('release-0.5')
    expect(term.querySelector('.command-center__item-trailing')?.textContent).toBe('Project canvas')
    expect(notes.querySelector('.command-center__item-subtitle')).toBeNull()
    const kindOf = (row: HTMLElement) =>
      row.querySelector('[data-cove-part="kind-tile"]')?.getAttribute('data-kind')
    expect(kindOf(notes)).toBe('knowledge')
    expect(kindOf(term)).toBe('shell')
    fireEvent.click(notes)
    expect(onSelectNode).toHaveBeenCalledWith('core', 'notes')
  })

  it('shows a working agent with its status pill and still finds it by Space', () => {
    renderCommandCenter()
    const agent = screen.getByTestId('command-center-item-window:agent-run')
    const pill = agent.querySelector('[data-cove-part="status-pill"]')
    expect(pill?.getAttribute('data-tone')).toBe('working')
    expect(pill?.textContent).toBe('Working')
    expect(agent.querySelector('.command-center__item-trailing')).toBeNull()
    fireEvent.change(screen.getByTestId('command-center-input'), {
      target: { value: 'project canvas' },
    })
    expect(screen.getByTestId('command-center-item-window:agent-run')).toBeTruthy()
  })

  it('finds a window by name and shows command shortcuts', () => {
    renderCommandCenter()
    fireEvent.change(screen.getByTestId('command-center-input'), { target: { value: 'pnpm' } })
    expect(screen.getAllByRole('option')[0]?.getAttribute('data-testid')).toBe(
      'command-center-item-window:term',
    )
    fireEvent.change(screen.getByTestId('command-center-input'), { target: { value: 'settings' } })
    const settings = screen.getByTestId('command-center-item-command:settings')
    expect(within(settings).getByText(/,/).tagName).toBe('KBD')
    expect(settings.getAttribute('aria-keyshortcuts')).toMatch(/\+,$/)
  })
})
