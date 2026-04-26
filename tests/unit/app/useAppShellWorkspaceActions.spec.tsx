import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
