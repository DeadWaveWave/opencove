import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ quit: vi.fn(), owner: vi.fn(), all: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter: MockEventEmitter } = await import('node:events')
  return {
    app: Object.assign(new MockEventEmitter(), { quit: mocks.quit }),
    BrowserWindow: { fromWebContents: mocks.owner },
    webContents: { getAllWebContents: mocks.all },
  }
})
import { app, type BrowserWindow, type WebContents } from 'electron'
import { registerApplicationShortcuts } from '../../src/app/main/applicationShortcuts'

function fixture() {
  vi.useFakeTimers()
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() })
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: contents,
  })
  mocks.owner.mockReturnValue(window)
  mocks.all.mockReturnValue([contents])
  const dispose = registerApplicationShortcuts(window as unknown as BrowserWindow)
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
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
describe('application shortcut boundary', () => {
  it('disposes captured contents after the native window getter is destroyed', () => {
    const f = fixture()
    Object.defineProperty(f.window, 'webContents', {
      get() {
        throw new Error('Object has been destroyed')
      },
    })
    expect(() => f.dispose()).not.toThrow()
    expect(f.contents.listenerCount('before-input-event')).toBe(0)
    expect(f.contents.listenerCount('render-process-gone')).toBe(0)
  })
  it('prevents native defaults even without a renderer listener', () => {
    const f = fixture()
    expect(f.key('keyDown', 'w')).toHaveBeenCalledOnce()
    expect(f.contents.send).toHaveBeenCalledWith('app:shortcut', 'close-selected-node')
    expect(mocks.quit).not.toHaveBeenCalled()
    f.dispose()
  })
  it('does not emit quit cancellation for ordinary key input', () => {
    const f = fixture()
    f.key('keyDown', 'x')
    expect(f.contents.send).not.toHaveBeenCalledWith('app:shortcut', 'quit-cancelled')
    f.dispose()
  })
  it.each(['blur', 'did-start-navigation', 'render-process-gone', 'timeout'])(
    'cancels on %s',
    event => {
      if (process.platform !== 'darwin') {
        return
      }
      const f = fixture()
      f.key('keyDown')
      f.key('keyUp')
      if (event === 'timeout') {
        vi.advanceTimersByTime(1500)
      } else if (event === 'blur') {
        f.window.emit(event)
      } else {
        f.contents.emit(event)
      }
      f.key('keyDown')
      f.key('keyUp')
      expect(mocks.quit).not.toHaveBeenCalled()
      expect(f.contents.send).toHaveBeenCalledWith('app:shortcut', 'quit-cancelled')
      f.dispose()
    },
  )
  it.each(['x', 'w'])('cancels the pending hint exactly once on %s', value => {
    if (process.platform !== 'darwin') {
      return
    }
    const f = fixture()
    f.key('keyDown')
    f.contents.send.mockClear()
    f.key('keyDown', value)
    f.key('keyDown', 'x')
    expect(f.contents.send.mock.calls.filter(call => call[1] === 'quit-cancelled')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.quit).not.toHaveBeenCalled()
    f.dispose()
  })
  it('enters the existing quit coordinator once without keyUp and disposes subscriptions', () => {
    if (process.platform !== 'darwin') {
      return
    }
    const f = fixture()
    f.key('keyDown')
    expect(mocks.quit).not.toHaveBeenCalled()
    f.key('keyDown')
    f.key('keyDown')
    expect(mocks.quit).toHaveBeenCalledOnce()
    f.dispose()
    expect(f.contents.listenerCount('before-input-event')).toBe(0)
    expect(f.window.listenerCount('blur')).toBe(0)
    expect(app.listenerCount('web-contents-created')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('routes native child contents to the owner, ignoring unrelated contents', () => {
    const f = fixture()
    const child = Object.assign(new EventEmitter(), { isDestroyed: () => false })
    app.emit('web-contents-created', {}, child as unknown as WebContents)
    expect(child.listenerCount('before-input-event')).toBe(1)
    mocks.owner.mockReturnValue(null)
    expect(f.key('keyDown', 'w')).not.toHaveBeenCalled()
    f.dispose()
    expect(child.listenerCount('before-input-event')).toBe(0)
  })
})
