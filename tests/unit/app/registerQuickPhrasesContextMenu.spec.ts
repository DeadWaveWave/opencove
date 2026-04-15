import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  },
}))

describe('registerQuickPhrasesContextMenu', () => {
  it('does not throw when disposed after the window is destroyed', async () => {
    vi.resetModules()
    const { registerQuickPhrasesContextMenu } =
      await import('../../../src/app/main/contextMenu/registerQuickPhrasesContextMenu')

    const removeListener = vi.fn(() => {
      throw new TypeError('Object has been destroyed')
    })

    const disposable = registerQuickPhrasesContextMenu({
      window: {
        isDestroyed: () => true,
        webContents: {
          isDestroyed: () => true,
          on: vi.fn(),
          removeListener,
        },
      } as unknown as BrowserWindow,
      userDataPath: '/mock/user-data',
      workerEndpointResolver: null,
    })

    expect(() => disposable.dispose()).not.toThrow()
    expect(removeListener).not.toHaveBeenCalled()
  })
})
