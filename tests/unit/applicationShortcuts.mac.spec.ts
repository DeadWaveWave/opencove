import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./applicationShortcuts.helpers')).electronMock())
import { app } from 'electron'
import { registerApplicationShortcuts } from '../../src/app/main/applicationShortcuts'
import { createFixture, mocks } from './applicationShortcuts.helpers'

const fixture = () => createFixture(registerApplicationShortcuts)
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
describe('application shortcut boundary (macOS)', () => {
  it
    .skipIf(process.platform !== 'darwin')
    .each(['blur', 'did-start-navigation', 'render-process-gone', 'timeout'])(
    'cancels on %s',
    event => {
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
  it.skipIf(process.platform !== 'darwin').each(['x', 'w'])(
    'cancels the pending hint exactly once on %s',
    value => {
      const f = fixture()
      f.key('keyDown')
      f.contents.send.mockClear()
      f.key('keyDown', value)
      f.key('keyDown', 'x')
      expect(f.contents.send.mock.calls.filter(call => call[1] === 'quit-cancelled')).toHaveLength(
        1,
      )
      expect(vi.getTimerCount()).toBe(0)
      expect(mocks.quit).not.toHaveBeenCalled()
      f.dispose()
    },
  )
  it.skipIf(process.platform !== 'darwin')(
    'enters the existing quit coordinator once without keyUp and disposes subscriptions',
    () => {
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
    },
  )
})
