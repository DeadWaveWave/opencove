import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { broadcastWindowFullScreen } from '../../../src/app/main/ipc/windowFullScreen'

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

describe('broadcastWindowFullScreen', () => {
  it('tells the renderer when its window enters and leaves full screen', () => {
    const window = fakeWindow()
    broadcastWindowFullScreen(window as unknown as BrowserWindow)

    window.emit('enter-full-screen')
    window.emit('leave-full-screen')

    expect(window.webContents.send.mock.calls).toEqual([
      [IPC_CHANNELS.windowChromeFullScreenChanged, { isFullScreen: true }],
      [IPC_CHANNELS.windowChromeFullScreenChanged, { isFullScreen: false }],
    ])
  })

  it('sends nothing to a destroyed window', () => {
    const window = fakeWindow()
    broadcastWindowFullScreen(window as unknown as BrowserWindow)

    window.destroyed = true
    window.emit('leave-full-screen')

    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
