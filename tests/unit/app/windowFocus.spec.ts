import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { broadcastWindowFocus } from '../../../src/app/main/ipc/windowFocus'

function fakeWindow() {
  const window = new EventEmitter() as EventEmitter & {
    destroyed: boolean
    isDestroyed: () => boolean
    webContents: { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean }
  }
  window.destroyed = false
  window.isDestroyed = () => window.destroyed
  window.webContents = { send: vi.fn(), isDestroyed: () => window.destroyed }
  return window
}

describe('broadcastWindowFocus', () => {
  it('tells the renderer when its window gains and loses focus', () => {
    const window = fakeWindow()
    broadcastWindowFocus(window as unknown as BrowserWindow)

    window.emit('blur')
    window.emit('focus')

    expect(window.webContents.send.mock.calls).toEqual([
      [IPC_CHANNELS.windowChromeFocusChanged, { isFocused: false }],
      [IPC_CHANNELS.windowChromeFocusChanged, { isFocused: true }],
    ])
  })

  it('sends nothing to a destroyed window', () => {
    const window = fakeWindow()
    broadcastWindowFocus(window as unknown as BrowserWindow)

    window.destroyed = true
    window.emit('blur')

    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
