// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createPluginFilesystemHandlers } from '../../../../src/app/main/controlSurface/handlers/pluginFilesystemHandlers'
import type { PluginResolvedTarget } from '../../../../src/contexts/plugins/domain/pluginHostTypes'
const target: PluginResolvedTarget = {
  projectId: 'p',
  spaceId: null,
  mountId: 'm',
  endpointId: 'remote',
  rootUri: 'file:///repo',
  cwdUri: 'file:///repo',
  workingDirectory: '/repo',
}
function fixture() {
  const invoke = vi.fn(async () => undefined as unknown)
  const revalidate = vi.fn(async () => undefined)
  const service = createPluginFilesystemHandlers({
    invoke: async <T>(...args: [string, 'command' | 'query', unknown, (() => void)?]) =>
      (await invoke(...args)) as T,
    resolve: async () => target,
    revalidate,
  })
  const authority = { ownerId: 'owner', assertActive: vi.fn() }
  return {
    invoke,
    revalidate,
    service,
    authority,
    call: (method: string, payload: object) =>
      service.request(authority, `filesystem.${method}`, payload),
  }
}
describe('plugin filesystem method boundaries', () => {
  it.each(['../escape', '/etc/passwd', 'C:\\windows', '..\\escape', 'a\0b'])(
    'rejects escaped path %j before provider dispatch',
    async path => {
      const { invoke, call } = fixture()
      await expect(
        call('writeText', { target: { projectId: 'p' }, path, content: 'x', overwrite: false }),
      ).rejects.toThrow()
      expect(invoke).not.toHaveBeenCalled()
    },
  )
  it('requires mutation intent and UTF-8 byte limits before dispatch', async () => {
    const { invoke, call } = fixture()
    await Promise.all(
      [
        { target: {}, path: 'a', content: 'x' },
        { target: {}, path: 'a', content: 'x', overwrite: 'false' },
        { target: {}, path: 'a', content: '界'.repeat(350000), overwrite: false },
        { target: {}, path: '.', content: 'x', overwrite: true },
      ].map(payload => expect(call('writeText', payload)).rejects.toThrow()),
    )
    await expect(call('delete', { target: {}, path: 'a' })).rejects.toThrow('recursive')
    await expect(call('rename', { target: {}, path: 'a', newPath: '../b' })).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })
  it('revalidates a target before mutation and passes flags to its actual mount', async () => {
    const { invoke, call, revalidate, authority } = fixture()
    revalidate.mockRejectedValueOnce(new Error('Target changed'))
    await expect(
      call('writeText', { target: {}, path: 'a', content: 'x', overwrite: false }),
    ).rejects.toThrow('changed')
    expect(invoke).not.toHaveBeenCalled()
    expect(
      await call('writeText', { target: {}, path: 'a', content: 'x', overwrite: false }),
    ).toEqual({ target, uri: 'file:///repo/a' })
    expect(invoke).toHaveBeenCalledWith(
      'filesystem.writeFileTextInMount',
      'command',
      {
        mountId: 'm',
        uri: 'file:///repo/a',
        content: 'x',
        overwrite: false,
      },
      authority.assertActive,
    )
  })
  it('retains literal path whitespace and rejects oversized watch directories explicitly', async () => {
    const { invoke, call } = fixture()
    invoke.mockResolvedValueOnce({ kind: 'directory', sizeBytes: 0, mtimeMs: 1 })
    invoke.mockResolvedValueOnce({ entries: [], truncated: true })
    await expect(call('watch', { target: {}, path: ' spaced ' })).rejects.toThrow('256')
    expect(invoke).toHaveBeenNthCalledWith(1, 'filesystem.statInMount', 'query', {
      mountId: 'm',
      uri: 'file:///repo/%20spaced%20',
    })
  })
})
