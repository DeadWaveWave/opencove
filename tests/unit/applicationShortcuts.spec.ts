import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./applicationShortcuts.helpers')).electronMock())
import { app, type WebContents } from 'electron'
import { registerApplicationShortcuts } from '../../src/app/main/applicationShortcuts'
import { createFixture, mocks } from './applicationShortcuts.helpers'

const fixture = () => createFixture(registerApplicationShortcuts)
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
