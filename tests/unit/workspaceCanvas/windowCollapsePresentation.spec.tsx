import React, { useEffect } from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { WindowCollapsePresentation } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WindowCollapsePresentation'
import {
  WorkspaceCollapseContext,
  type WorkspaceCollapseValue,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WorkspaceCollapseContext'
import { WindowCollapseButton } from '@contexts/workspace/presentation/renderer/components/shared/WindowCollapseButton'
import { useCollapsedAgentMessage } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/useCollapsedAgentMessage'
import { CollapsedWindow } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/CollapsedWindow'

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
  toggleSpace: vi.fn(),
  revealNode: vi.fn(),
  collapseAndArrange: vi.fn(),
  undoArrange: vi.fn(),
  canUndoArrange: () => false,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('window collapse presentation', () => {
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
    render(
      <WorkspaceCollapseContext.Provider value={value}>
        <WindowCollapsePresentation
          id="document"
          data={nodeData({ collapsePresentation: { collapsed: true, spaceHidden: false } })}
        >
          <WindowCollapseButton onClose={guardedClose} revealBeforeClose />
        </WindowCollapsePresentation>
      </WorkspaceCollapseContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }))
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
      <CollapsedWindow
        id="agent"
        data={value}
        message="Actual progress"
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const { rerender } = render(view(data))
    const icon = screen.getByTestId('collapsed-node-agent')
    expect(icon).toHaveAttribute('data-animated', 'true')
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
})

describe('collapsed Agent message projection', () => {
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

  it('reads actual messages, never overlaps a pending request and stops after expanding', async () => {
    vi.useFakeTimers()
    let resolveMessage!: (value: { message: string }) => void
    const readLastMessage = vi.fn(
      () =>
        new Promise<{ message: string }>(resolve => {
          resolveMessage = resolve
        }),
    )
    window.opencoveApi = { agent: { readLastMessage } } as never
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useCollapsedAgentMessage(agent, enabled),
      { initialProps: { enabled: true } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(readLastMessage).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveMessage({ message: 'Implemented the actual change.' })
    })
    expect(result.current).toBe('Implemented the actual change.')
    rerender({ enabled: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(readLastMessage).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('rejects a stale session response after a session switch', async () => {
    let first!: (value: { message: string }) => void
    let second!: (value: { message: string }) => void
    const readLastMessage = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            first = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            second = resolve
          }),
      )
    window.opencoveApi = { agent: { readLastMessage } } as never
    const { result, rerender, unmount } = renderHook(
      ({ data }) => useCollapsedAgentMessage(data, true),
      { initialProps: { data: agent } },
    )
    rerender({ data: { ...agent, sessionId: 'pty-2' } })
    await act(async () => {
      second({ message: 'Current session' })
    })
    await act(async () => {
      first({ message: 'Old session' })
    })
    expect(result.current).toBe('Current session')
    unmount()
  })
})
