import { fireEvent, render, screen } from '@testing-library/react'
import React, { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../store/useAppStore'
import type { ProjectContextMenuState } from '../types'
import { useProjectContextMenuDismiss } from '../hooks/useProjectContextMenuDismiss'
import { ProjectContextMenu } from './ProjectContextMenu'

function createWorkspace(): WorkspaceState {
  return {
    id: 'workspace-a',
    name: 'Project A',
    path: '/tmp/workspace-a',
    worktreesRoot: '',
    nodes: [
      {
        id: 'agent-a',
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        data: {
          sessionId: 'agent-a-session',
          title: 'codex · Default model',
          width: 320,
          height: 240,
          kind: 'agent',
          status: 'running',
          startedAt: '2026-03-29T10:00:00.000Z',
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          executionDirectory: '/tmp/workspace-a',
          expectedDirectory: '/tmp/workspace-a',
          agent: {
            provider: 'codex',
            prompt: 'ship it',
            model: 'gpt-5.2-codex',
            effectiveModel: 'gpt-5.2-codex',
            launchMode: 'new',
            resumeSessionId: null,
            executionDirectory: '/tmp/workspace-a',
            expectedDirectory: '/tmp/workspace-a',
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
            taskId: null,
          },
          task: null,
          note: null,
          role: null,
          image: null,
          document: null,
          website: null,
        },
        type: 'default',
        measured: { width: 320, height: 240 },
        selected: false,
        dragging: false,
        deletable: true,
      },
    ],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [
      {
        id: 'space-a',
        name: 'Space A',
        directoryPath: '/tmp/workspace-a',
        targetMountId: null,
        labelColor: 'blue',
        nodeIds: ['agent-a'],
        rect: null,
      },
    ],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

function renderMenu(target?: Parameters<typeof ProjectContextMenu>[0]['target']): void {
  const workspace = createWorkspace()
  useAppStore.getState().setWorkspaces([workspace])
  render(
    <ProjectContextMenu
      workspaces={[workspace]}
      workspaceId="workspace-a"
      target={target}
      x={40}
      y={60}
      onRequestManageMounts={vi.fn()}
      onRequestOpenInFileManager={vi.fn()}
      onRequestRemove={vi.fn()}
    />,
  )
}

function submitRename(nextName: string): void {
  fireEvent.click(screen.getByTestId('workspace-project-context-menu-rename'))
  fireEvent.change(screen.getByLabelText('Rename'), { target: { value: nextName } })
  fireEvent.click(screen.getByTestId('workspace-project-context-menu-rename-save'))
}

describe('ProjectContextMenu', () => {
  beforeEach(() => {
    useAppStore.setState({ workspaces: [], projectContextMenu: null })
  })

  it('renames a project target', () => {
    renderMenu({ kind: 'project', workspaceId: 'workspace-a' })

    submitRename('Project Renamed')

    expect(useAppStore.getState().workspaces[0]?.name).toBe('Project Renamed')
  })

  it('renames a space target', () => {
    renderMenu({ kind: 'space', workspaceId: 'workspace-a', spaceId: 'space-a' })

    fireEvent.change(screen.getByLabelText('Rename'), { target: { value: 'Space Renamed' } })
    fireEvent.blur(screen.getByLabelText('Rename'))

    expect(useAppStore.getState().workspaces[0]?.spaces[0]?.name).toBe('Space Renamed')
  })

  it('renames an agent target and pins its title', () => {
    renderMenu({ kind: 'agent', workspaceId: 'workspace-a', nodeId: 'agent-a' })

    submitRename('Agent Renamed')

    const agent = useAppStore.getState().workspaces[0]?.nodes[0]?.data
    expect(agent?.title).toBe('codex · Agent Renamed')
    expect(agent?.titlePinnedByUser).toBe(true)
  })

  it('updates a space label color from the context menu', () => {
    renderMenu({ kind: 'space', workspaceId: 'workspace-a', spaceId: 'space-a' })

    fireEvent.click(screen.getByTestId('workspace-project-context-menu-label-color-green'))

    expect(useAppStore.getState().workspaces[0]?.spaces[0]?.labelColor).toBe('green')
  })

  it('keeps the context menu open while changing label colors', () => {
    const workspace = createWorkspace()
    useAppStore.setState({
      workspaces: [workspace],
      projectContextMenu: {
        workspaceId: 'workspace-a',
        target: { kind: 'space', workspaceId: 'workspace-a', spaceId: 'space-a' },
        x: 40,
        y: 60,
      },
    })

    function Harness(): React.JSX.Element {
      const workspaces = useAppStore(state => state.workspaces)
      const menu = useAppStore(state => state.projectContextMenu)

      if (!menu) {
        return <div data-testid="closed" />
      }

      return (
        <ProjectContextMenu
          workspaces={workspaces}
          workspaceId={menu.workspaceId}
          target={menu.target}
          x={menu.x}
          y={menu.y}
          onRequestManageMounts={vi.fn()}
          onRequestOpenInFileManager={vi.fn()}
          onRequestRemove={vi.fn()}
        />
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByTestId('workspace-project-context-menu-label-color-green'))
    expect(useAppStore.getState().workspaces[0]?.spaces[0]?.labelColor).toBe('green')
    expect(useAppStore.getState().projectContextMenu).not.toBeNull()
    expect(screen.queryByTestId('workspace-project-context-menu-label-colors')).not.toBeNull()

    fireEvent.click(screen.getByTestId('workspace-project-context-menu-label-color-purple'))
    expect(useAppStore.getState().workspaces[0]?.spaces[0]?.labelColor).toBe('purple')
    expect(useAppStore.getState().projectContextMenu).not.toBeNull()
    expect(screen.queryByTestId('workspace-project-context-menu-label-colors')).not.toBeNull()
  })

  it('renders space edit controls above the context menu separator', () => {
    renderMenu({ kind: 'space', workspaceId: 'workspace-a', spaceId: 'space-a' })

    const menu = screen.getByRole('textbox').closest('.workspace-project-context-menu')
    const children = Array.from(menu?.children ?? [])

    expect(children[0]?.className).toContain('workspace-project-context-menu__space-editor')
    expect(children[1]?.className).toContain('workspace-project-context-menu__color-space')
    expect(children[2]?.className).toContain('workspace-context-menu__separator')
  })

  it('updates an agent label color override from the context menu', () => {
    renderMenu({ kind: 'agent', workspaceId: 'workspace-a', nodeId: 'agent-a' })

    fireEvent.click(screen.getByTestId('workspace-project-context-menu-label-color-purple'))

    expect(useAppStore.getState().workspaces[0]?.nodes[0]?.data.labelColorOverride).toBe('purple')
  })

  it('dismisses the context menu when clicking outside workspace menus', () => {
    function Harness(): React.JSX.Element {
      const [menu, setMenu] = useState<ProjectContextMenuState | null>({
        workspaceId: 'workspace-a',
        x: 0,
        y: 0,
      })
      useProjectContextMenuDismiss({
        projectContextMenu: menu,
        setProjectContextMenu: setMenu,
      })

      return (
        <>
          <div data-testid="canvas" />
          {menu ? <div className="workspace-context-menu" data-testid="menu" /> : null}
        </>
      )
    }

    render(<Harness />)

    fireEvent.mouseDown(screen.getByTestId('menu'))
    expect(screen.queryByTestId('menu')).not.toBeNull()

    fireEvent.mouseDown(screen.getByTestId('canvas'))
    expect(screen.queryByTestId('menu')).toBeNull()
  })

  it('dismisses the context menu before canvas mouse handlers can stop propagation', () => {
    function Harness(): React.JSX.Element {
      const [menu, setMenu] = useState<ProjectContextMenuState | null>({
        workspaceId: 'workspace-a',
        x: 0,
        y: 0,
      })
      useProjectContextMenuDismiss({
        projectContextMenu: menu,
        setProjectContextMenu: setMenu,
      })

      return (
        <>
          <div
            data-testid="canvas"
            onMouseDown={event => {
              event.stopPropagation()
            }}
          />
          {menu ? <div className="workspace-context-menu" data-testid="menu" /> : null}
        </>
      )
    }

    render(<Harness />)

    fireEvent.mouseDown(screen.getByTestId('canvas'))
    expect(screen.queryByTestId('menu')).toBeNull()
  })
})
