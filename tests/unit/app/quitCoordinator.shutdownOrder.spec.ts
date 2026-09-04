import { describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({
  beforeQuit: null as ((event: { preventDefault: () => void }) => void) | null,
  quit: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: (event: { preventDefault: () => void }) => void) => {
      if (event === 'before-quit') {
        electronState.beforeQuit = listener
      }
    },
    quit: electronState.quit,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

import { registerQuitCoordinator } from '../../../src/app/main/quitCoordinator'

describe('quit coordinator local Worker ownership', () => {
  it('disconnects runtime clients before stopping the owned Worker', async () => {
    const order: string[] = []
    const preventDefault = vi.fn()
    registerQuitCoordinator({
      hasOwnedLocalWorkerProcess: () => true,
      disconnectRuntimeClients: () => {
        order.push('disconnect-clients')
      },
      stopOwnedLocalWorker: async () => {
        order.push('stop-worker')
      },
    })

    electronState.beforeQuit?.({ preventDefault })

    await vi.waitFor(() => {
      expect(order).toEqual(['disconnect-clients', 'stop-worker'])
      expect(electronState.quit).toHaveBeenCalledTimes(1)
    })
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})
