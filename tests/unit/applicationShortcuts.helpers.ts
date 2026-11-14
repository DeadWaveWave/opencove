import { EventEmitter } from 'node:events'
import { vi } from 'vitest'
import type { BrowserWindow } from 'electron'

export const mocks = { quit: vi.fn(), owner: vi.fn(), all: vi.fn() }

// The factory of `vi.mock('electron', ...)`, shared by the specs of the application shortcuts.
export async function electronMock() {
  const { EventEmitter: MockEventEmitter } = await import('node:events')
  return {
    app: Object.assign(new MockEventEmitter(), { quit: mocks.quit }),
    BrowserWindow: { fromWebContents: mocks.owner },
    webContents: { getAllWebContents: mocks.all },
  }
}

export function createFixture(register: (window: BrowserWindow) => () => void) {
  vi.useFakeTimers()
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() })
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: contents,
  })
  mocks.owner.mockReturnValue(window)
  mocks.all.mockReturnValue([contents])
  const dispose = register(window as unknown as BrowserWindow)
  const key = (type: string, value = 'q') => {
    const preventDefault = vi.fn()
    contents.emit(
      'before-input-event',
      { preventDefault },
      {
        type,
        key: value,
        meta: process.platform === 'darwin',
        control: process.platform !== 'darwin',
        shift: false,
        alt: false,
        isAutoRepeat: false,
      },
    )
    return preventDefault
  }
  return { contents, window, key, dispose }
}
