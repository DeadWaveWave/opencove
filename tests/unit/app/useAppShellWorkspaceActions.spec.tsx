import React from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslateFn } from '../../../src/app/renderer/i18n'
import { useAppShellWorkspaceActions } from '../../../src/app/renderer/shell/hooks/useAppShellWorkspaceActions'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'

function HookHarness({
  workspaceId,
  t,
  showMessage,
}: {
  workspaceId: string
  t: TranslateFn
  showMessage: (message: string, tone?: 'info' | 'warning' | 'error') => void
}): React.JSX.Element {
  const { handleRequestOpenProjectInFileManager } = useAppShellWorkspaceActions({
    requestPersistFlush: () => undefined,
    t,
    showMessage,
  })

  return (
    <button
      type="button"
      data-testid="open-project-in-file-manager"
      onClick={() => {
        handleRequestOpenProjectInFileManager(workspaceId)
      }}
    >
      Open
    </button>
  )
}

describe('useAppShellWorkspaceActions', () => {
  const openPath = vi.fn(async () => undefined)
  const invoke = vi.fn()
  const showMessage = vi.fn()
  const t: TranslateFn = (key, options) => {
    if (key === 'messages.projectNoLocalLocationToOpen') {
      return 'no local location'
    }

    if (key === 'messages.projectOpenInFileManagerFailed') {
      return `open failed: ${String(options?.message ?? '')}`
    }

    return key
  }

  beforeEach(() => {
    openPath.mockClear()
    invoke.mockReset()
    showMessage.mockReset()

    useAppStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      projectContextMenu: {
        workspaceId: 'workspace-1',
        x: 120,
        y: 80,
      },
      projectMountManager: null,
      projectDeleteConfirmation: null,
      isRemovingProject: false,
      focusRequest: null,
      persistNotice: null,
    })

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        workspace: {
          openPath,
        },
        controlSurface: {
          invoke,
        },
      },
    })
  })

  afterEach(() => {
    delete (window as { opencoveApi?: unknown }).opencoveApi
  })

  it('carries explicit input intent and defaults agent navigation to input focus', () => {
    const { result } = renderHook(() =>
      useAppShellWorkspaceActions({ requestPersistFlush: vi.fn(), t, showMessage }),
    )

    act(() => result.current.handleSelectAgentNode('workspace-1', 'agent-1', { focusInput: false }))
    expect(useAppStore.getState().activeWorkspaceId).toBe('workspace-1')
    expect(useAppStore.getState().focusRequest).toEqual({
      kind: 'node',
      workspaceId: 'workspace-1',
      nodeId: 'agent-1',
      sequence: 1,
      focusInput: false,
    })

    act(() => result.current.handleSelectAgentNode('workspace-1', 'agent-1'))
    expect(useAppStore.getState().focusRequest).toMatchObject({ sequence: 2, focusInput: true })
  })

  it('returns to the project canvas without changing its viewport or another project', () => {
    const workspace = {
      id: 'workspace-1',
      name: 'workspace-1',
      path: '/workspace',
      worktreesRoot: '',
      nodes: [],
      viewport: { x: -400, y: 120, zoom: 0.7 },
      isMinimapVisible: true,
      spaces: [],
      activeSpaceId: 'space-1',
      spaceArchiveRecords: [],
    }
    const otherWorkspace = { ...workspace, id: 'workspace-2' }
    useAppStore.setState({
      workspaces: [workspace, otherWorkspace],
      activeWorkspaceId: 'workspace-2',
      focusRequest: { kind: 'node', workspaceId: 'workspace-2', nodeId: 'agent-2', sequence: 1 },
    })
    const { result } = renderHook(() =>
      useAppShellWorkspaceActions({ requestPersistFlush: vi.fn(), t, showMessage }),
    )

    act(() => result.current.handleSelectProjectCanvas('workspace-1'))
    const state = useAppStore.getState()
    expect(state.activeWorkspaceId).toBe('workspace-1')
    expect(state.focusRequest).toBeNull()
    expect(state.workspaces[0]).toEqual({ ...workspace, activeSpaceId: null })
    expect(state.workspaces[0].viewport).toBe(workspace.viewport)
    expect(state.workspaces[1]).toBe(otherWorkspace)
  })

  it('preserves the active space when switching through a project rail icon', () => {
    useAppStore.setState({
      workspaces: [
        {
          id: 'workspace-1',
          name: 'workspace-1',
          path: '/workspace',
          worktreesRoot: '',
          nodes: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [],
          activeSpaceId: 'space-1',
          spaceArchiveRecords: [],
        },
      ],
    })
    const { result } = renderHook(() =>
      useAppShellWorkspaceActions({ requestPersistFlush: vi.fn(), t, showMessage }),
    )

    act(() => result.current.handleSelectWorkspace('workspace-1'))
    expect(useAppStore.getState().workspaces[0].activeSpaceId).toBe('space-1')
  })

  it('opens the first local mount in the system file manager', async () => {
    useAppStore.setState({
      workspaces: [
        {
          id: 'workspace-1',
          name: 'workspace-1',
          path: '/fallback/workspace',
          worktreesRoot: '',
          nodes: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [],
          activeSpaceId: null,
          spaceArchiveRecords: [],
        },
      ],
    })

    invoke.mockResolvedValue({
      projectId: 'workspace-1',
      mounts: [
        {
          mountId: 'mount-remote',
          endpointId: 'remote-1',
          rootPath: '/remote/workspace',
          sortOrder: 0,
        },
        {
          mountId: 'mount-local',
          endpointId: 'local',
          rootPath: '/local/workspace',
          sortOrder: 1,
        },
      ],
    })

    render(<HookHarness workspaceId="workspace-1" t={t} showMessage={showMessage} />)
    fireEvent.click(screen.getByTestId('open-project-in-file-manager'))

    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith({
        path: '/local/workspace',
        openerId: 'finder',
      })
    })

    expect(showMessage).not.toHaveBeenCalled()
    expect(useAppStore.getState().projectContextMenu).toBeNull()
  })

  it('falls back to the legacy workspace path when mounts are not available yet', async () => {
    useAppStore.setState({
      workspaces: [
        {
          id: 'workspace-1',
          name: 'workspace-1',
          path: '/legacy/workspace',
          worktreesRoot: '',
          nodes: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [],
          activeSpaceId: null,
          spaceArchiveRecords: [],
        },
      ],
    })

    invoke.mockResolvedValue({
      projectId: 'workspace-1',
      mounts: [],
    })

    render(<HookHarness workspaceId="workspace-1" t={t} showMessage={showMessage} />)
    fireEvent.click(screen.getByTestId('open-project-in-file-manager'))

    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith({
        path: '/legacy/workspace',
        openerId: 'finder',
      })
    })

    expect(showMessage).not.toHaveBeenCalled()
  })

  it('shows a warning when the project only has remote locations', async () => {
    useAppStore.setState({
      workspaces: [
        {
          id: 'workspace-1',
          name: 'workspace-1',
          path: '/placeholder/projects/workspace-1',
          worktreesRoot: '',
          nodes: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [],
          activeSpaceId: null,
          spaceArchiveRecords: [],
        },
      ],
    })

    invoke.mockResolvedValue({
      projectId: 'workspace-1',
      mounts: [
        {
          mountId: 'mount-remote',
          endpointId: 'remote-1',
          rootPath: '/remote/workspace',
          sortOrder: 0,
        },
      ],
    })

    render(<HookHarness workspaceId="workspace-1" t={t} showMessage={showMessage} />)
    fireEvent.click(screen.getByTestId('open-project-in-file-manager'))

    await waitFor(() => {
      expect(showMessage).toHaveBeenCalledWith('no local location', 'warning')
    })

    expect(openPath).not.toHaveBeenCalled()
  })
})
