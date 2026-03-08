import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

export function createIpcMainMock() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  }

  return { handlers, ipcMain }
}

export function createSpawnMock() {
  return vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
    child.unref = vi.fn()
    queueMicrotask(() => {
      child.emit('spawn')
    })
    return child
  })
}

export function restorePlatform(originalPlatform: string) {
  vi.restoreAllMocks()
  vi.doUnmock('node:child_process')
  vi.doUnmock('electron')
  vi.resetModules()
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  })
}
