import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => {
  const contentsById = new Map<
    number,
    {
      destroyed: (() => void) | null
    }
  >()

  return {
    contentsById,
    fromId: vi.fn((id: number) => {
      const content = contentsById.get(id)
      if (!content) {
        return null
      }

      return {
        isDestroyed: () => false,
        getType: () => 'window',
        once: (event: string, listener: () => void) => {
          if (event === 'destroyed') {
            content.destroyed = listener
          }
        },
      }
    }),
  }
})

vi.mock('electron', () => ({
  webContents: {
    fromId: electronState.fromId,
  },
}))

import { createEnsureRemotePtySessionAttached } from '../../../src/app/main/controlSurface/remote/remotePtyRuntime.attach'
import { createRemotePtySessionCoordinator } from '../../../src/app/main/controlSurface/remote/remotePtyRuntime.sessionCoordinator'

function createMockSocket() {
  return {
    send: vi.fn(),
  }
}

describe('remotePtyRuntime session coordinator', () => {
  beforeEach(() => {
    electronState.contentsById.clear()
    electronState.fromId.mockClear()
  })

  it('keeps a tracked session attached when the last window subscriber is destroyed', async () => {
    const sendDetachMessage = vi.fn(async () => undefined)
    const coordinator = createRemotePtySessionCoordinator({
      connectTimeoutMs: 50,
      cancelMetadataWatcher: vi.fn(),
      shouldKeepSocketAlive: () => true,
      closeSocket: vi.fn(),
      sendDetachMessage,
    })
    const socket = createMockSocket()

    electronState.contentsById.set(1, { destroyed: null })

    coordinator.noteSessionRolePreference('session-1', 'controller')
    coordinator.trackWebContentsDestroyed(1)
    coordinator.addSubscriber(1, 'session-1')
    coordinator.sendAttachForSession(socket as never, 'session-1')
    coordinator.onSessionAttached('session-1', { role: 'controller', epoch: 1 })

    await expect(coordinator.waitForSessionAttached('session-1')).resolves.toEqual({
      sessionId: 'session-1',
      authority: { role: 'controller', epoch: 1 },
    })
    coordinator.onAuthorityChanged('session-1', { role: 'viewer', epoch: 2 })
    await expect(coordinator.waitForSessionAttached('session-1')).resolves.toEqual({
      sessionId: 'session-1',
      authority: { role: 'viewer', epoch: 2 },
    })

    electronState.contentsById.get(1)?.destroyed?.()

    expect(sendDetachMessage).not.toHaveBeenCalled()
    expect(coordinator.hasTrackedSession('session-1')).toBe(true)
    await expect(coordinator.waitForSessionAttached('session-1')).resolves.toEqual({
      sessionId: 'session-1',
      authority: { role: 'viewer', epoch: 2 },
    })
  })

  it('clears stale attach state once an untracked session loses its last subscriber', async () => {
    const sendDetachMessage = vi.fn(async () => undefined)
    const coordinator = createRemotePtySessionCoordinator({
      connectTimeoutMs: 50,
      cancelMetadataWatcher: vi.fn(),
      shouldKeepSocketAlive: () => true,
      closeSocket: vi.fn(),
      sendDetachMessage,
    })
    const firstSocket = createMockSocket()
    const secondSocket = createMockSocket()

    coordinator.noteSessionRolePreference('session-1', 'controller')
    coordinator.addSubscriber(1, 'session-1')
    coordinator.sendAttachForSession(firstSocket as never, 'session-1')
    coordinator.onSessionAttached('session-1', { role: 'controller', epoch: 1 })

    coordinator.untrackSession('session-1')
    await coordinator.removeSubscriber(1, 'session-1')

    expect(sendDetachMessage).toHaveBeenCalledWith('session-1')

    coordinator.noteSessionRolePreference('session-1', 'controller')
    coordinator.sendAttachForSession(secondSocket as never, 'session-1')

    expect(secondSocket.send).toHaveBeenCalledTimes(1)
  })

  it('clears connection-local authority and requires a fresh attach ACK after disconnect', async () => {
    const coordinator = createRemotePtySessionCoordinator({
      connectTimeoutMs: 50,
      cancelMetadataWatcher: vi.fn(),
      shouldKeepSocketAlive: () => true,
      closeSocket: vi.fn(),
      sendDetachMessage: vi.fn(async () => undefined),
    })
    const socket = createMockSocket()
    coordinator.noteSessionRolePreference('session-reconnect', 'controller')
    coordinator.sendAttachForSession(socket as never, 'session-reconnect')
    coordinator.attachedSessions.set('session-reconnect', {
      lastSeq: 4,
      role: 'controller',
      authorityEpoch: 7,
    })
    coordinator.onSessionAttached('session-reconnect', { role: 'controller', epoch: 7 })

    coordinator.onSocketClosed()

    expect(coordinator.attachedSessions.get('session-reconnect')).toMatchObject({
      role: 'viewer',
      authorityEpoch: null,
    })
    let attached = false
    const pendingAttach = coordinator.waitForSessionAttached('session-reconnect').then(() => {
      attached = true
    })
    await Promise.resolve()
    expect(attached).toBe(false)

    coordinator.sendAttachForSession(createMockSocket() as never, 'session-reconnect')
    coordinator.onSessionAttached('session-reconnect', { role: 'controller', epoch: 8 })
    await pendingAttach
    expect(attached).toBe(true)
  })

  it('rejects an attach when session exit wins the socket connection race', async () => {
    let resolveSocket!: () => void
    const coordinator = createRemotePtySessionCoordinator({
      connectTimeoutMs: 50,
      cancelMetadataWatcher: vi.fn(),
      shouldKeepSocketAlive: () => true,
      closeSocket: vi.fn(),
      sendDetachMessage: vi.fn(async () => undefined),
    })
    const socket = { readyState: 1, send: vi.fn() }
    const ensureAttached = createEnsureRemotePtySessionAttached({
      sessionCoordinator: coordinator,
      ensureSocket: async () =>
        await new Promise<void>(resolve => {
          resolveSocket = resolve
        }),
      getSocket: () => socket as never,
    })
    coordinator.trackSession('session-exited-during-attach')

    const attaching = ensureAttached('session-exited-during-attach')
    coordinator.untrackSession('session-exited-during-attach', new Error('Terminal session exited'))
    coordinator.onSessionAttached('session-exited-during-attach', {
      role: 'controller',
      epoch: 1,
    })
    resolveSocket()

    await expect(attaching).rejects.toThrow('exited before attach completed')
    expect(socket.send).not.toHaveBeenCalled()
    expect(coordinator.isStreamAttached('session-exited-during-attach')).toBe(false)
  })

  it('does not return live after an attach acknowledgement is followed by exit', async () => {
    const coordinator = createRemotePtySessionCoordinator({
      connectTimeoutMs: 50,
      cancelMetadataWatcher: vi.fn(),
      shouldKeepSocketAlive: () => true,
      closeSocket: vi.fn(),
      sendDetachMessage: vi.fn(async () => undefined),
    })
    const socket = { readyState: 1, send: vi.fn() }
    const ensureAttached = createEnsureRemotePtySessionAttached({
      sessionCoordinator: coordinator,
      ensureSocket: vi.fn(async () => undefined),
      getSocket: () => socket as never,
    })
    coordinator.trackSession('session-exit-after-ack')

    const attaching = ensureAttached('session-exit-after-ack')
    await Promise.resolve()
    expect(socket.send).toHaveBeenCalledTimes(1)
    coordinator.onSessionAttached('session-exit-after-ack', { role: 'controller', epoch: 1 })
    coordinator.untrackSession('session-exit-after-ack', new Error('Terminal session exited'))

    await expect(attaching).rejects.toThrow('exited before attach completed')
    expect(coordinator.isStreamAttached('session-exit-after-ack')).toBe(false)
  })

  it('rejects pending attach waiters immediately when their session exits', async () => {
    const coordinator = createRemotePtySessionCoordinator({
      connectTimeoutMs: 10_000,
      cancelMetadataWatcher: vi.fn(),
      shouldKeepSocketAlive: () => true,
      closeSocket: vi.fn(),
      sendDetachMessage: vi.fn(async () => undefined),
    })
    coordinator.trackSession('session-pending-exit')
    const waiting = coordinator.waitForSessionAttached('session-pending-exit')

    coordinator.untrackSession('session-pending-exit', new Error('Terminal session exited'))

    await expect(waiting).rejects.toThrow('Terminal session exited')
  })

  it('rejects a pending attach immediately when the socket disconnects', async () => {
    const coordinator = createRemotePtySessionCoordinator({
      connectTimeoutMs: 5_000,
      cancelMetadataWatcher: vi.fn(),
      shouldKeepSocketAlive: () => true,
      closeSocket: vi.fn(),
      sendDetachMessage: vi.fn(async () => undefined),
    })
    const socket = createMockSocket()
    coordinator.noteSessionRolePreference('session-pending', 'controller')
    coordinator.sendAttachForSession(socket as never, 'session-pending')
    const pending = coordinator.waitForSessionAttached('session-pending')
    const rejection = expect(pending).rejects.toThrow('connection closed')

    coordinator.onSocketClosed()

    await rejection
  })

  it('reattaches from the minimum cursor still required by active subscribers', async () => {
    const coordinator = createRemotePtySessionCoordinator({
      connectTimeoutMs: 50,
      cancelMetadataWatcher: vi.fn(),
      shouldKeepSocketAlive: () => true,
      closeSocket: vi.fn(),
      sendDetachMessage: vi.fn(async () => undefined),
    })
    coordinator.noteSessionRolePreference('session-shared-cursor', 'controller')
    coordinator.addSubscriber(1, 'session-shared-cursor', 12)
    coordinator.addSubscriber(2, 'session-shared-cursor', 4)
    const firstSocket = createMockSocket()

    coordinator.sendAttachForSession(firstSocket as never, 'session-shared-cursor')
    expect(JSON.parse(firstSocket.send.mock.calls[0]?.[0] as string)).toMatchObject({
      type: 'attach',
      afterSeq: 4,
    })
    coordinator.onSessionAttached('session-shared-cursor', { role: 'controller', epoch: 1 })
    coordinator.noteSubscriberSeq('session-shared-cursor', 2, 15)
    coordinator.onSocketClosed()

    const secondSocket = createMockSocket()
    coordinator.sendAttachForSession(secondSocket as never, 'session-shared-cursor')
    expect(JSON.parse(secondSocket.send.mock.calls[0]?.[0] as string)).toMatchObject({
      afterSeq: 12,
    })
    coordinator.onSessionAttached('session-shared-cursor', { role: 'controller', epoch: 2 })
    await coordinator.removeSubscriber(1, 'session-shared-cursor')
    coordinator.onSocketClosed()

    const thirdSocket = createMockSocket()
    coordinator.sendAttachForSession(thirdSocket as never, 'session-shared-cursor')
    expect(JSON.parse(thirdSocket.send.mock.calls[0]?.[0] as string)).toMatchObject({
      afterSeq: 15,
    })
  })

  it('reports whether a tracked session is attached to the worker stream', () => {
    const coordinator = createRemotePtySessionCoordinator({
      connectTimeoutMs: 50,
      cancelMetadataWatcher: vi.fn(),
      shouldKeepSocketAlive: () => true,
      closeSocket: vi.fn(),
      sendDetachMessage: vi.fn(async () => undefined),
    })
    const socket = createMockSocket()
    coordinator.noteSessionRolePreference('session-replay', 'controller')
    expect(coordinator.isStreamAttached('session-replay')).toBe(false)
    coordinator.sendAttachForSession(socket as never, 'session-replay')
    coordinator.onSessionAttached('session-replay', { role: 'controller', epoch: 1 })

    expect(coordinator.isStreamAttached('session-replay')).toBe(true)
    coordinator.onSocketClosed()
    expect(coordinator.isStreamAttached('session-replay')).toBe(false)
  })
})
