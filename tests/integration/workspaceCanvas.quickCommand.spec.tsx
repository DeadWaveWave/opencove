import { act, renderHook, waitFor } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import type { QuickCommand } from '../../src/contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../src/contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasQuickMenuActions } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.quickMenuActions'
import { useWorkspaceCanvasNodeCreation } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.createNodes'
import { createRemotePtySessionCoordinator } from '../../src/app/main/controlSurface/remote/remotePtyRuntime.sessionCoordinator'
import {
  attachRemotePtyRenderer,
  createEnsureRemotePtySessionAttached,
  RemotePtyAgentStateReplay,
} from '../../src/app/main/controlSurface/remote/remotePtyRuntime.attach'
import { writeRemotePtyThroughAttachedSocket } from '../../src/app/main/controlSurface/remote/remotePtyRuntime.socketSend'

vi.mock('electron', () => ({ webContents: { fromId: () => null } }))

function quickCommand(command = 'echo configured'): QuickCommand {
  return {
    id: 'command',
    title: 'Configured command',
    kind: 'terminal',
    command,
    enabled: true,
    pinned: true,
  }
}

const disposables: Array<() => void> = []
afterEach(() => {
  disposables.splice(0).forEach(dispose => dispose())
  vi.unstubAllGlobals()
})

function setup() {
  const coordinator = createRemotePtySessionCoordinator({
    connectTimeoutMs: 1000,
    cancelMetadataWatcher: vi.fn(),
    shouldKeepSocketAlive: () => true,
    closeSocket: vi.fn(),
    sendDetachMessage: vi.fn(async () => undefined),
  })
  disposables.push(() => coordinator.clear())
  const messages: Array<{ type: string; sessionId: string; data?: string }> = []
  const socket = {
    readyState: WebSocket.OPEN,
    send: (data: string) => messages.push(JSON.parse(data)),
  } as unknown as WebSocket
  const ensureSessionAttached = createEnsureRemotePtySessionAttached({
    sessionCoordinator: coordinator,
    ensureSocket: async () => undefined,
    getSocket: () => socket,
  })
  const attach = vi.fn(async ({ sessionId }: { sessionId: string }) =>
    attachRemotePtyRenderer({
      contentsId: 1,
      sessionId,
      sessionCoordinator: coordinator,
      ensureSessionAttached,
      agentStateReplay: new RemotePtyAgentStateReplay(),
    }),
  )
  const write = vi.fn(async (input: { sessionId: string; data: string }) =>
    writeRemotePtyThroughAttachedSocket({
      ...input,
      ensureSessionAttached,
      getSocket: () => socket,
    }),
  )
  const spawn = vi.fn(async () => ({
    sessionId: 'created-session',
    profileId: null,
    runtimeKind: 'posix',
  }))
  const invoke = vi.fn(async ({ id }: { id: string }) => {
    if (id === 'mount.list') {
      return { mounts: [] }
    }
    if (id === 'pty.spawn') {
      return spawn()
    }
    throw new Error(`Unexpected command: ${id}`)
  })
  vi.stubGlobal('opencoveApi', {
    pty: { attach, write, spawn, kill: vi.fn() },
    controlSurface: { invoke },
  })
  const nodesRef = { current: [] as Node<TerminalNodeData>[] }
  const onShowMessage = vi.fn()
  const hook = renderHook(
    ({ workspaceId }) => {
      const creationOptions = {
        nodesRef,
        spacesRef: { current: [] },
        setNodes: (updater: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) => {
          nodesRef.current = updater(nodesRef.current)
        },
        standardWindowSizeBucket: 'regular' as const,
        browserDefaultMode: 'native' as const,
        onShowMessage,
      }
      const creation = useWorkspaceCanvasNodeCreation(creationOptions)
      return useWorkspaceCanvasQuickMenuActions({
        ...creationOptions,
        ...creation,
        contextMenu: { kind: 'pane', x: 100, y: 100, flowX: 100, flowY: 100 },
        setContextMenu: vi.fn(),
        workspaceId,
        // A detached worktree uses Control Surface spawn, outside the workspace root.
        workspacePath: '/workspace',
        spacesRef: {
          current: [
            {
              id: 'space',
              name: 'Worktree',
              directoryPath: '/worktree',
              targetMountId: null,
              labelColor: null,
              nodeIds: [],
              rect: { x: 0, y: 0, width: 2000, height: 1500 },
            },
          ],
        },
        websiteWindowsEnabled: true,
        defaultTerminalProfileId: null,
        terminalFontSize: 13,
        terminalDisplayMetrics: { fontSize: 13 },
        onSpacesChange: vi.fn(),
      })
    },
    { initialProps: { workspaceId: 'workspace' } },
  )
  return { ...hook, coordinator, messages, attach, write, spawn, invoke, nodesRef, onShowMessage }
}

describe('terminal quick command launch and PTY attachment', () => {
  it('waits for attachment before writing to a Control Surface-created session', async () => {
    const harness = setup()
    let launch!: Promise<void>
    act(() => {
      launch = harness.result.current.runQuickCommand(quickCommand())
    })
    const outcome = launch.catch(error => error)
    await waitFor(() => expect(harness.nodesRef.current).toHaveLength(1))
    await waitFor(() =>
      expect(harness.messages).toContainEqual(
        expect.objectContaining({ type: 'attach', sessionId: 'created-session' }),
      ),
    )
    expect(harness.messages.filter(message => message.type === 'write')).toEqual([])
    harness.coordinator.onSessionAttached('created-session', { role: 'controller', epoch: 1 })
    await expect(outcome).resolves.toBeUndefined()
    expect(harness.messages.filter(message => message.type === 'write')).toEqual([
      { type: 'write', sessionId: 'created-session', data: 'echo configured\r' },
    ])
    expect(harness.spawn).toHaveBeenCalledTimes(1)
  })

  it.each(['echo configured\n', 'echo configured\r\n', 'echo configured\r'])(
    'submits an already terminated command without adding an extra Enter: %j',
    async command => {
      const harness = setup()
      harness.coordinator.noteSessionRolePreference('created-session', 'controller')
      let launch!: Promise<void>
      act(() => {
        launch = harness.result.current.runQuickCommand(quickCommand(command))
      })
      await waitFor(() => expect(harness.attach).toHaveBeenCalledTimes(1))
      harness.coordinator.onSessionAttached('created-session', { role: 'controller', epoch: 1 })
      await launch
      expect(harness.write).toHaveBeenCalledExactlyOnceWith({
        sessionId: 'created-session',
        data: 'echo configured\r',
      })
    },
  )

  it('does not write after the node is removed while attach is pending', async () => {
    const harness = setup()
    let launch!: Promise<void>
    act(() => {
      launch = harness.result.current.runQuickCommand(quickCommand())
    })
    await waitFor(() => expect(harness.attach).toHaveBeenCalledTimes(1))
    harness.nodesRef.current = []
    harness.coordinator.onSessionAttached('created-session', { role: 'controller', epoch: 1 })
    await launch
    expect(harness.write).not.toHaveBeenCalled()
  })

  it.each(['unmount', 'workspace-switch'] as const)('cancels pending input on %s', async action => {
    const harness = setup()
    let launch!: Promise<void>
    act(() => {
      launch = harness.result.current.runQuickCommand(quickCommand())
    })
    await waitFor(() => expect(harness.attach).toHaveBeenCalledTimes(1))
    if (action === 'unmount') {
      harness.unmount()
    } else {
      harness.rerender({ workspaceId: 'another-workspace' })
    }
    harness.coordinator.onSessionAttached('created-session', { role: 'controller', epoch: 1 })
    await launch
    expect(harness.write).not.toHaveBeenCalled()
  })

  it('shares the TerminalNode attachment without duplicate subscriptions or geometry writes', async () => {
    const harness = setup()
    let launch!: Promise<void>
    act(() => {
      launch = harness.result.current.runQuickCommand(quickCommand())
    })
    await waitFor(() => expect(harness.messages).toHaveLength(1))
    const terminalNodeAttach = harness.attach({ sessionId: 'created-session' })
    harness.coordinator.onSessionAttached('created-session', { role: 'controller', epoch: 1 })
    await Promise.all([launch, terminalNodeAttach])
    expect(harness.coordinator.subscribersBySessionId.get('created-session')).toEqual(new Set([1]))
    expect(harness.messages.map(message => message.type)).toEqual(['attach', 'write'])
    await harness.coordinator.removeSubscriber(1, 'created-session')
    expect(harness.coordinator.subscribersBySessionId.has('created-session')).toBe(false)
  })

  it.each([
    ['echo first\n\necho last', 'echo first\r\recho last\r'],
    ['echo first\r\n\r\necho last\r\n\r\n', 'echo first\r\recho last\r\r'],
    ['echo first\n\necho last\n\n', 'echo first\r\recho last\r\r'],
  ])('preserves explicit blank lines and trailing newlines in %j', async (command, data) => {
    const harness = setup()
    let launch!: Promise<void>
    act(() => {
      launch = harness.result.current.runQuickCommand(quickCommand(command))
    })
    await waitFor(() => expect(harness.messages).toHaveLength(1))
    harness.coordinator.onSessionAttached('created-session', { role: 'controller', epoch: 1 })
    await launch
    expect(harness.write).toHaveBeenCalledExactlyOnceWith({ sessionId: 'created-session', data })
  })

  it('reports attach failure without writing or leaving an unhandled rejection', async () => {
    const harness = setup()
    harness.attach.mockRejectedValueOnce(new Error('Connection closed'))
    await act(async () => {
      await harness.result.current.runQuickCommand(quickCommand())
    })
    expect(harness.write).not.toHaveBeenCalled()
    expect(harness.onShowMessage).toHaveBeenCalledWith(
      expect.stringContaining('Connection closed'),
      'error',
    )
  })

  it('reports write failure without retrying the command', async () => {
    const harness = setup()
    harness.attach.mockResolvedValueOnce({
      sessionId: 'created-session',
      authority: { role: 'controller', epoch: 1 },
    })
    harness.write.mockRejectedValueOnce(new Error('Write failed'))
    await act(async () => {
      await harness.result.current.runQuickCommand(quickCommand())
    })
    expect(harness.write).toHaveBeenCalledTimes(1)
    expect(harness.onShowMessage).toHaveBeenCalledWith(
      expect.stringContaining('Write failed'),
      'error',
    )
  })

  it('does not attach or write when spawn fails', async () => {
    const harness = setup()
    harness.spawn.mockRejectedValueOnce(new Error('Spawn failed'))
    await act(async () => {
      await harness.result.current.runQuickCommand(quickCommand())
    })
    expect(harness.nodesRef.current).toEqual([])
    expect(harness.attach).not.toHaveBeenCalled()
    expect(harness.write).not.toHaveBeenCalled()
  })

  it('ignores an empty command', async () => {
    const harness = setup()
    await act(async () => {
      await harness.result.current.runQuickCommand(quickCommand('  '))
    })
    expect(harness.spawn).not.toHaveBeenCalled()
    expect(harness.write).not.toHaveBeenCalled()
  })
})
