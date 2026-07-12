import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasSpaceUi } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceUi'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'

function HookHost(): React.JSX.Element {
  const [contextMenu, setContextMenu] = React.useState(null)
  const [, setEmptySelectionPrompt] = React.useState(null)

  const spacesRef = React.useRef<WorkspaceSpaceState[]>([
    {
      id: 'space-1',
      name: 'Space 1',
      directoryPath: '/tmp/opencove-space',
      targetMountId: null,
      labelColor: null,
      nodeIds: [],
      rect: null,
    },
  ])

  const ui = useWorkspaceCanvasSpaceUi({
    contextMenu,
    setContextMenu,
    setEmptySelectionPrompt,
    cancelSpaceRename: () => undefined,
    workspacePath: '/tmp/opencove-workspace',
    spacesRef,
    handlePaneClick: () => undefined,
    handlePaneContextMenu: () => undefined,
    handleNodeContextMenu: () => undefined,
    handleSelectionContextMenu: () => undefined,
  })

  return (
    <div>
      <span data-testid="openers-count">{ui.availablePathOpeners.length}</span>
      <output data-testid="worktree-operations">
        {JSON.stringify(ui.spaceWorktreeOperations)}
      </output>
      <button
        type="button"
        data-testid="open-space-menu"
        onClick={() => ui.openSpaceActionMenu('space-1', { x: 120, y: 80 })}
      >
        Open menu
      </button>
      <button
        type="button"
        data-testid="open-create-worktree"
        onClick={() => ui.openSpaceCreateWorktree('space-1', { x: 320, y: 88 })}
      >
        Create worktree
      </button>
      <button
        type="button"
        data-testid="mark-worktree-running"
        onClick={() => {
          const operation = ui.spaceWorktreeOperations[0]
          if (operation) {
            ui.setSpaceWorktreeOperationPhase(operation.id, 'running')
          }
        }}
      >
        Mark running
      </button>
      <button
        type="button"
        data-testid="open-archive"
        onClick={() => ui.openSpaceArchive('space-1', { x: 420, y: 128 })}
      >
        Archive
      </button>
      <button
        type="button"
        data-testid="copy-space-path"
        onClick={() => {
          void ui.copySpacePath('space-1')
        }}
      >
        Copy
      </button>
    </div>
  )
}

describe('useWorkspaceCanvasSpaceUi (web UI differences)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: undefined,
    })
  })

  afterEach(() => {
    delete (window as { opencoveApi?: unknown }).opencoveApi
  })

  it('uses browser clipboard when Electron IPC copyPath API is unavailable', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<HookHost />)
    fireEvent.click(screen.getByTestId('copy-space-path'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('/tmp/opencove-space')
    })
  })

  it('prefers Electron IPC copyPath API when available (desktop)', async () => {
    const copyPath = vi.fn(async () => undefined)
    const writeText = vi.fn(async () => undefined)

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        workspace: {
          copyPath,
        },
      },
    })

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<HookHost />)
    fireEvent.click(screen.getByTestId('copy-space-path'))

    await waitFor(() => {
      expect(copyPath).toHaveBeenCalledWith({ path: '/tmp/opencove-space' })
    })

    expect(writeText).not.toHaveBeenCalled()
  })

  it('keeps the path openers empty when listPathOpeners is unavailable (web)', async () => {
    render(<HookHost />)

    fireEvent.click(screen.getByTestId('open-space-menu'))

    await waitFor(() => {
      expect(screen.getByTestId('openers-count')).toHaveTextContent('0')
    })
  })

  it('loads available path openers when listPathOpeners is available (desktop)', async () => {
    const listPathOpeners = vi.fn(async () => ({
      openers: [
        { id: 'finder', label: 'Finder' },
        { id: 'terminal', label: 'Terminal' },
      ],
    }))

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        workspace: {
          listPathOpeners,
        },
      },
    })

    render(<HookHost />)
    fireEvent.click(screen.getByTestId('open-space-menu'))

    await waitFor(() => {
      expect(screen.getByTestId('openers-count')).toHaveTextContent('2')
    })

    expect(listPathOpeners).toHaveBeenCalledTimes(1)
  })

  it('keeps a submitted operation while opening another anchored draft', () => {
    render(<HookHost />)

    fireEvent.click(screen.getByTestId('open-create-worktree'))
    expect(screen.getByTestId('worktree-operations')).toHaveTextContent('"anchor":{"x":320,"y":88}')

    fireEvent.click(screen.getByTestId('mark-worktree-running'))
    fireEvent.click(screen.getByTestId('open-archive'))

    const operations = JSON.parse(screen.getByTestId('worktree-operations').textContent ?? '[]')
    expect(operations).toHaveLength(2)
    expect(operations[0]).toMatchObject({
      spaceId: 'space-1',
      initialViewMode: 'create',
      phase: 'running',
    })
    expect(operations[1]).toMatchObject({
      spaceId: 'space-1',
      initialViewMode: 'archive',
      phase: 'draft',
      anchor: { x: 420, y: 128 },
    })
  })
})
