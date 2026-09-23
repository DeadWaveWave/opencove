import React, { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { WindowCollapsePresentation } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WindowCollapsePresentation'
import {
  WorkspaceCollapseContext,
  type WorkspaceCollapseValue,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WorkspaceCollapseContext'
import { WindowCollapseButton } from '@contexts/workspace/presentation/renderer/components/shared/WindowCollapseButton'
import { CollapsedWindow } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/CollapsedWindow'
import { WindowNodeContextMenuContext } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WindowNodeContextMenuContext'

const nodeData = (overrides: Partial<TerminalNodeData> = {}): TerminalNodeData => ({
  sessionId: 'pty-1',
  title: 'Editor',
  width: 800,
  height: 600,
  kind: 'document',
  status: null,
  startedAt: null,
  endedAt: null,
  exitCode: null,
  lastError: null,
  scrollback: null,
  agent: null,
  task: null,
  note: null,
  image: null,
  document: null,
  website: null,
  ...overrides,
})

const context = (): WorkspaceCollapseValue => ({
  workspaceId: 'project',
  nodes: [],
  spaces: [],
  collapsedNodeIds: {},
  collapsedSpaceIds: {},
  toggleNode: vi.fn(),
  revealNode: vi.fn(),
  collapseAndArrange: vi.fn(),
  undoArrange: vi.fn(),
  canUndoArrange: () => false,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('window collapse presentation', () => {
  it.each([
    {
      kind: 'document' as const,
      title: 'package.json',
      document: { uri: 'file:///project/config/package.json' },
      glyph: 'file-json',
    },
    {
      kind: 'folder' as const,
      title: 'design',
      folder: {
        uri: 'file:///project/docs/design',
        rootUri: 'file:///project',
        viewMode: 'list' as const,
        expandedDirectoryUris: [],
      },
      glyph: 'folder',
    },
  ])('keeps the compact $kind identity to its icon and name without a parent path', entry => {
    const onExpand = vi.fn()
    const { container } = render(
      <CollapsedWindow id="file-entry" data={nodeData(entry)} onExpand={onExpand} />,
    )
    const icon = screen.getByTestId('collapsed-node-file-entry')
    expect(icon).toHaveStyle({ width: '112px', height: '96px' })
    expect(icon.textContent).toBe(entry.title)
    expect(icon.querySelector('[data-cove-file-icon]')).toHaveAttribute(
      'data-cove-file-icon',
      entry.glyph,
    )
    expect(container.querySelector('.cove-collapsed-window__title')).toHaveTextContent(entry.title)
    expect(container.querySelector('button[aria-label*="Close"]')).toBeNull()
    fireEvent.click(screen.getByTestId('node-expand'))
    expect(onExpand).toHaveBeenCalledOnce()
  })

  it('retains runtime mount, editor state and full geometry across node and Space collapse', () => {
    const mounted = vi.fn()
    const disposed = vi.fn()
    function Runtime() {
      useEffect(() => {
        mounted()
        return disposed
      }, [])
      return <textarea aria-label="Draft" defaultValue="unsaved content" />
    }
    const value = context()
    const view = (collapsed: boolean, spaceHidden = false) => (
      <WorkspaceCollapseContext.Provider value={value}>
        <WindowCollapsePresentation
          id="document"
          data={nodeData({ collapsePresentation: { collapsed, spaceHidden } })}
        >
          <Runtime />
        </WindowCollapsePresentation>
      </WorkspaceCollapseContext.Provider>
    )
    const { container, rerender } = render(view(false))
    const editor = screen.getByRole('textbox')
    fireEvent.change(editor, { target: { value: 'keep my changes' } })
    rerender(view(true))
    const runtime = container.querySelector('.cove-node-presentation__runtime')
    expect(runtime).toHaveStyle({ width: '800px', height: '600px' })
    expect(runtime).toHaveAttribute('inert')
    expect(runtime).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('collapsed-node-document')).toBeInTheDocument()
    rerender(view(true, true))
    expect(screen.queryByTestId('collapsed-node-document')).not.toBeInTheDocument()
    expect(runtime).toHaveStyle({ width: '800px', height: '600px' })
    rerender(view(false))
    expect(screen.getByRole('textbox')).toBe(editor)
    expect(editor).toHaveValue('keep my changes')
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(disposed).not.toHaveBeenCalled()
  })

  it('uses the original close guard and reveals a dirty document before its prompt', () => {
    const order: string[] = []
    const value = context()
    vi.mocked(value.toggleNode).mockImplementation(() => {
      order.push('expand')
    })
    const guardedClose = vi.fn(() => order.push('prompt'))
    const openMenu = vi.fn()
    render(
      <WorkspaceCollapseContext.Provider value={value}>
        <WindowNodeContextMenuContext.Provider value={openMenu}>
          <WindowCollapsePresentation
            id="document"
            data={nodeData({ collapsePresentation: { collapsed: true, spaceHidden: false } })}
          >
            <WindowCollapseButton onClose={guardedClose} revealBeforeClose />
          </WindowCollapsePresentation>
        </WindowNodeContextMenuContext.Provider>
      </WorkspaceCollapseContext.Provider>,
    )
    expect(screen.queryByRole('button', { name: 'Close window' })).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('node-expand'))
    expect(openMenu).toHaveBeenCalledOnce()
    expect(openMenu.mock.calls[0][0]).toMatchObject({ nodeId: 'document' })
    act(() => openMenu.mock.calls[0][0].closeWindow())
    expect(order).toEqual(['expand', 'prompt'])
    expect(guardedClose).toHaveBeenCalledTimes(1)
  })

  it('opens an icon with one click or keyboard but does not open after dragging or shift selection', () => {
    const value = context()
    const toggleSelection = vi.fn()
    render(
      <WorkspaceCollapseContext.Provider value={value}>
        <WindowCollapsePresentation
          id="document"
          onToggleSelection={toggleSelection}
          data={nodeData({ collapsePresentation: { collapsed: true, spaceHidden: false } })}
        >
          <textarea aria-label="Draft" />
        </WindowCollapsePresentation>
      </WorkspaceCollapseContext.Provider>,
    )
    const icon = screen.getByTestId('node-expand')
    expect(icon).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(icon)
    fireEvent.keyDown(icon, { key: 'Enter' })
    fireEvent.keyDown(icon, { key: ' ' })
    expect(value.toggleNode).toHaveBeenCalledTimes(3)
    fireEvent.click(icon, { shiftKey: true })
    expect(toggleSelection).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(icon, { clientX: 10, clientY: 10 })
    fireEvent.click(icon, { clientX: 60, clientY: 10 })
    expect(value.toggleNode).toHaveBeenCalledTimes(3)
  })

  it('stops pixel work animation for degraded and restoring Agent observations', () => {
    const data = nodeData({
      kind: 'agent',
      status: 'running',
      agentRuntimeObservation: {
        status: 'running',
        source: 'codex_hook',
        hookInstallState: 'installed',
        degraded: false,
      },
      agent: {
        provider: 'codex',
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'new',
        resumeSessionId: 'verified',
        executionDirectory: '/project',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
        expectedDirectory: null,
      },
    })
    const view = (value: TerminalNodeData) => (
      <CollapsedWindow id="agent" data={value} onExpand={vi.fn()} />
    )
    const { rerender } = render(view(data))
    const icon = screen.getByTestId('collapsed-node-agent')
    expect(icon).toHaveAttribute('data-animated', 'true')
    expect(icon).toHaveAttribute('data-status', 'running')
    expect(icon.querySelector('.cove-collapsed-window__status')).toBeNull()
    expect(icon.querySelector('.cove-collapsed-window__message')).toBeNull()
    expect(screen.getByTestId('node-expand')).toHaveAttribute('aria-description', 'Working')
    expect(icon.querySelector('[data-agent-provider]')).toHaveAttribute(
      'data-agent-provider',
      'codex',
    )
    rerender(
      view({
        ...data,
        agentRuntimeObservation: { ...data.agentRuntimeObservation!, degraded: true },
      }),
    )
    expect(icon).not.toHaveAttribute('data-animated')
    rerender(view({ ...data, status: 'restoring' }))
    expect(icon).not.toHaveAttribute('data-animated')
  })

  it('keeps inactive compact chrome mounted without exposing a drag handle or active controls', () => {
    const onExpand = vi.fn()
    const view = (active: boolean) => (
      <CollapsedWindow id="inactive" data={nodeData()} active={active} onExpand={onExpand} />
    )
    const { container, rerender } = render(view(false))
    const launch = screen.getByTestId('node-expand')
    const icon = container.querySelector('.cove-collapsed-window__icon')
    expect(screen.queryByRole('button', { name: 'Close window' })).toBeNull()
    expect(container.querySelectorAll('[data-node-drag-handle=true]')).toHaveLength(0)
    expect(launch).toHaveAttribute('tabindex', '-1')
    expect(launch).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(launch)
    fireEvent.keyDown(launch, { key: 'Enter' })
    expect(onExpand).not.toHaveBeenCalled()

    rerender(view(true))
    expect(container.querySelector('.cove-collapsed-window__icon')).toBe(icon)
    expect(container.querySelectorAll('[data-node-drag-handle=true]')).toHaveLength(1)
    expect(launch).toHaveAttribute('tabindex', '0')
    expect(launch).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByRole('button', { name: 'Close window' })).toBeNull()
    fireEvent.click(launch)
    expect(onExpand).toHaveBeenCalledOnce()

    rerender(view(false))
    expect(container.querySelectorAll('[data-node-drag-handle=true]')).toHaveLength(0)
  })
})

describe('collapsed Agent presentation', () => {
  const agent = nodeData({
    kind: 'agent',
    status: 'running',
    startedAt: '2026-09-19T00:00:00.000Z',
    agent: {
      provider: 'codex',
      prompt: '',
      model: null,
      effectiveModel: null,
      launchMode: 'new',
      resumeSessionId: 'codex-1',
      executionDirectory: '/project',
      expectedDirectory: null,
      directoryMode: 'workspace',
      customDirectory: null,
      shouldCreateDirectory: false,
      taskId: null,
    },
  })

  it('shows only a compact icon and title without polling Agent messages', async () => {
    vi.useFakeTimers()
    const readLastMessage = vi.fn(async () => ({ message: 'Latest runtime progress' }))
    window.opencoveApi = { agent: { readLastMessage } } as never
    const value = context()
    render(
      <WorkspaceCollapseContext.Provider value={value}>
        <WindowCollapsePresentation
          id="agent"
          data={{ ...agent, collapsePresentation: { collapsed: true, spaceHidden: false } }}
        >
          <textarea aria-label="Agent runtime" defaultValue="Runtime stays mounted" />
        </WindowCollapsePresentation>
      </WorkspaceCollapseContext.Provider>,
    )
    const icon = screen.getByTestId('collapsed-node-agent')
    expect(icon).toHaveStyle({ width: '112px', height: '96px' })
    expect(icon.querySelector('.cove-collapsed-window__message')).toBeNull()
    expect(icon).toHaveAttribute('data-status', 'running')
    expect(screen.getByTestId('node-expand')).toHaveAttribute('aria-description', 'Working')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(readLastMessage).not.toHaveBeenCalled()
  })
})
