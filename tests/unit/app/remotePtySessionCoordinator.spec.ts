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
    coordinator.onSessionAttached('session-1')

    await expect(coordinator.waitForSessionAttached('session-1')).resolves.toBeUndefined()

    electronState.contentsById.get(1)?.destroyed?.()

    expect(sendDetachMessage).not.toHaveBeenCalled()
    expect(coordinator.hasTrackedSession('session-1')).toBe(true)
    await expect(coordinator.waitForSessionAttached('session-1')).resolves.toBeUndefined()
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
    coordinator.onSessionAttached('session-1')

    coordinator.untrackSession('session-1')
    await coordinator.removeSubscriber(1, 'session-1')

    expect(sendDetachMessage).toHaveBeenCalledWith('session-1')

    coordinator.noteSessionRolePreference('session-1', 'controller')
    coordinator.sendAttachForSession(secondSocket as never, 'session-1')

    expect(secondSocket.send).toHaveBeenCalledTimes(1)
  })
})
