import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDroppedFile } from '@app/preload/filesystemDrop'
import { IPC_CHANNELS } from '@shared/contracts/ipc'

const native = vi.hoisted(() => ({ getPathForFile: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({
  webUtils: { getPathForFile: native.getPathForFile },
  ipcRenderer: { invoke: native.invoke },
}))

describe('native file preload boundary', () => {
  beforeEach(() => {
    native.getPathForFile.mockReset()
    native.invoke.mockReset()
  })

  it('uses only the native file path supplied by Electron', async () => {
    const file = new File([], 'misleading-name.md')
    native.getPathForFile.mockReturnValue('/explicit/real-name.md')
    native.invoke.mockResolvedValue({ uri: 'file:///explicit/real-name.md', kind: 'file' })
    await expect(resolveDroppedFile(file)).resolves.toMatchObject({
      uri: 'file:///explicit/real-name.md',
    })
    expect(native.getPathForFile).toHaveBeenCalledWith(file)
    expect(native.invoke).toHaveBeenCalledWith(IPC_CHANNELS.filesystemResolveDroppedPath, {
      path: '/explicit/real-name.md',
    })
  })

  it('does not grant access for an in-memory File even when its name looks absolute', async () => {
    native.getPathForFile.mockReturnValue('')
    await expect(resolveDroppedFile(new File([], '/pretend/path.md'))).resolves.toBeNull()
    expect(native.invoke).not.toHaveBeenCalled()
  })
})
