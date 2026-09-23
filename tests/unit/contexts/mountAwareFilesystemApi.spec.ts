import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveFilesystemApiForMount } from '@contexts/workspace/presentation/renderer/utils/mountAwareFilesystemApi'

function setApi(value: unknown): void {
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value })
}

afterEach(() => setApi(undefined))

describe('mount-aware filesystem routing', () => {
  it('returns the local API only for an explicitly local location', () => {
    const filesystem = { readDirectory: vi.fn() }
    setApi({ filesystem })

    expect(resolveFilesystemApiForMount(null)).toBe(filesystem)
    expect(resolveFilesystemApiForMount(undefined)).toBeNull()
  })

  it('does not fall back to local IO when a mounted location has no control surface', () => {
    const readDirectory = vi.fn()
    setApi({ filesystem: { readDirectory } })

    expect(resolveFilesystemApiForMount('remote-mount')).toBeNull()
    expect(readDirectory).not.toHaveBeenCalled()
    setApi({ filesystem: { readDirectory }, controlSurface: { invoke: false } })
    expect(resolveFilesystemApiForMount('remote-mount')).toBeNull()
  })

  it('routes reads through the original mount without touching the local API', async () => {
    const entries = [{ uri: 'file:///repo/docs', name: 'docs', kind: 'directory' }]
    const invoke = vi.fn().mockResolvedValue({ entries })
    const localRead = vi.fn()
    setApi({ controlSurface: { invoke }, filesystem: { readDirectory: localRead } })

    await expect(
      resolveFilesystemApiForMount('remote-mount')!.readDirectory({ uri: 'file:///repo' }),
    ).resolves.toEqual({ entries })
    expect(invoke).toHaveBeenCalledWith({
      kind: 'query',
      id: 'filesystem.readDirectoryInMount',
      payload: { mountId: 'remote-mount', uri: 'file:///repo' },
    })
    expect(localRead).not.toHaveBeenCalled()
  })

  it('propagates remote failures without retrying the same path locally', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('Disconnected'))
    const localRead = vi.fn()
    setApi({ controlSurface: { invoke }, filesystem: { readDirectory: localRead } })

    await expect(
      resolveFilesystemApiForMount('remote-mount')!.readDirectory({ uri: 'file:///repo' }),
    ).rejects.toThrow('Disconnected')
    expect(localRead).not.toHaveBeenCalled()
  })
})
