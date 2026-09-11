import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, clipboard, removeHandler } = vi.hoisted(() => ({
  handlers: new Map<string, () => unknown>(),
  clipboard: { readText: vi.fn(), readImage: vi.fn(), writeText: vi.fn() },
  removeHandler: vi.fn(),
}))

vi.mock('electron', () => ({ clipboard, ipcMain: { removeHandler } }))
vi.mock('../../../src/app/main/ipc/handle', () => ({
  registerHandledIpc: (channel: string, handler: () => unknown) => handlers.set(channel, handler),
}))

import { registerClipboardIpcHandlers } from '../../../src/contexts/clipboard/presentation/main-ipc/register'

describe('terminal clipboard snapshot', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
  })

  it.each([true, false])('reports native image presence %s alongside text', async hasImage => {
    clipboard.readText.mockReturnValue('clipboard text')
    clipboard.readImage.mockReturnValue({ isEmpty: () => !hasImage })
    const registration = registerClipboardIpcHandlers()
    const handler = handlers.get('clipboard:read-terminal-paste')
    expect(handler).toBeDefined()
    expect(await handler?.()).toEqual({ text: 'clipboard text', hasImage })
    registration.dispose()
    expect(removeHandler).toHaveBeenCalledWith('clipboard:read-terminal-paste')
  })
})
