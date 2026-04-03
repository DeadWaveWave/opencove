import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalDataEvent, TerminalExitEvent } from '@shared/contracts/dto'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { DEFAULT_WORKSPACE_VIEWPORT } from '@contexts/workspace/presentation/renderer/types'
import { useScrollbackStore } from '@contexts/workspace/presentation/renderer/store/useScrollbackStore'
import { useAppStore } from '../store/useAppStore'
import { usePtyWorkspaceScrollbackKeepalive } from './usePtyWorkspaceScrollbackKeepalive'

function TestHarness(): null {
  usePtyWorkspaceScrollbackKeepalive()
  return null
}

type TestPtyEmitter = {
  emitData: (event: TerminalDataEvent) => void
  emitExit: (event: TerminalExitEvent) => void
}

function getTestPtyEmitter(): TestPtyEmitter {
  return (window.opencoveApi as unknown as { __test: TestPtyEmitter }).__test
}

function createWorkspaceState(partial: Partial<WorkspaceState>): WorkspaceState {
  return {
    id: partial.id ?? 'workspace-1',
    name: partial.name ?? 'Workspace',
    path: partial.path ?? '/tmp/workspace',
    worktreesRoot: partial.worktreesRoot ?? '/tmp/workspace/.git',
    pullRequestBaseBranchOptions: partial.pullRequestBaseBranchOptions ?? [],
    nodes: partial.nodes ?? [],
    viewport: partial.viewport ?? DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: partial.isMinimapVisible ?? true,
    spaces: partial.spaces ?? [],
    activeSpaceId: partial.activeSpaceId ?? null,
    spaceArchiveRecords: partial.spaceArchiveRecords ?? [],
  }
}

describe('usePtyWorkspaceScrollbackKeepalive', () => {
  beforeEach(() => {
    vi.useFakeTimers()

    useAppStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
    })
    useScrollbackStore.getState().clearAllScrollbacks()

    let dataListener: ((event: TerminalDataEvent) => void) | null = null
    let exitListener: ((event: TerminalExitEvent) => void) | null = null

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          attach: vi.fn(async () => undefined),
          detach: vi.fn(async () => undefined),
          onData: vi.fn((listener: (event: TerminalDataEvent) => void) => {
            dataListener = listener
            return () => {
              dataListener = null
            }
          }),
          onExit: vi.fn((listener: (event: TerminalExitEvent) => void) => {
            exitListener = listener
            return () => {
              exitListener = null
            }
          }),
        },
        __test: {
          emitData: (event: TerminalDataEvent) => dataListener?.(event),
          emitExit: (event: TerminalExitEvent) => exitListener?.(event),
        },
      },
    })
  })

  it('flushes PTY output into scrollback store on an interval', async () => {
    useAppStore.setState({
      workspaces: [
        createWorkspaceState({
          nodes: [
            {
              id: 'node-1',
              type: 'terminalNode',
              position: { x: 0, y: 0 },
              data: {
                sessionId: 'session-1',
                title: 'Agent',
                width: 480,
                height: 320,
                kind: 'agent',
                status: 'running',
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
              },
              draggable: true,
            },
          ],
        }),
      ],
    })

    render(<TestHarness />)

    getTestPtyEmitter().emitData({ sessionId: 'session-1', data: 'hello' })
    await vi.advanceTimersByTimeAsync(2_000)

    expect(useScrollbackStore.getState().scrollbackByNodeId['node-1']).toContain('hello')
    expect(window.opencoveApi.pty.attach).toHaveBeenCalledWith({ sessionId: 'session-1' })
  })

  it('flushes PTY output immediately when the session exits', async () => {
    useAppStore.setState({
      workspaces: [
        createWorkspaceState({
          nodes: [
            {
              id: 'node-1',
              type: 'terminalNode',
              position: { x: 0, y: 0 },
              data: {
                sessionId: 'session-1',
                title: 'Agent',
                width: 480,
                height: 320,
                kind: 'agent',
                status: 'running',
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
              },
              draggable: true,
            },
          ],
        }),
      ],
    })

    render(<TestHarness />)

    const emitter = getTestPtyEmitter()
    emitter.emitData({ sessionId: 'session-1', data: 'hello' })
    emitter.emitExit({ sessionId: 'session-1', exitCode: 0 })

    expect(useScrollbackStore.getState().scrollbackByNodeId['node-1']).toContain('hello')
  })

  it('defers heavy scrollback flush work during wheel interaction', async () => {
    useAppStore.setState({
      workspaces: [
        createWorkspaceState({
          nodes: [
            {
              id: 'node-1',
              type: 'terminalNode',
              position: { x: 0, y: 0 },
              data: {
                sessionId: 'session-1',
                title: 'Agent',
                width: 480,
                height: 320,
                kind: 'agent',
                status: 'running',
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
              },
              draggable: true,
            },
          ],
        }),
      ],
    })

    render(<TestHarness />)

    getTestPtyEmitter().emitData({ sessionId: 'session-1', data: 'hello' })

    for (let time = 0; time < 2_000; time += 50) {
      window.setTimeout(() => {
        window.dispatchEvent(new WheelEvent('wheel'))
      }, time)
    }

    await vi.advanceTimersByTimeAsync(2_000)

    expect(useScrollbackStore.getState().scrollbackByNodeId['node-1'] ?? '').not.toContain('hello')

    await vi.advanceTimersByTimeAsync(240)

    expect(useScrollbackStore.getState().scrollbackByNodeId['node-1']).toContain('hello')
  })
})
