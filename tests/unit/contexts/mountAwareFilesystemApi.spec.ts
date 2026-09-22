import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveFilesystemApiForMount } from '../../../src/contexts/workspace/presentation/renderer/utils/mountAwareFilesystemApi'

afterEach(() => vi.unstubAllGlobals())

describe('mount-aware document source', () => {
  it('never substitutes the local filesystem for an unavailable mount transport', () => {
    const filesystem = { readFileBytes: vi.fn() }
    vi.stubGlobal('opencoveApi', { filesystem })
    expect(resolveFilesystemApiForMount('remote-mount')).toBeNull()
    expect(resolveFilesystemApiForMount(null)).toBe(filesystem)
  })

  it('keeps image bytes and metadata in the same mount scope', async () => {
    const uri = 'file:///repo/image.png'
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ uri, kind: 'file' })
      .mockResolvedValueOnce({ bytes: Uint8Array.of(137, 80) })
    const readFileBytes = vi.fn()
    vi.stubGlobal('opencoveApi', { filesystem: { readFileBytes }, controlSurface: { invoke } })
    const api = resolveFilesystemApiForMount('remote-mount')!
    await api.stat({ uri })
    expect(await api.readFileBytes!({ uri })).toEqual({ bytes: Uint8Array.of(137, 80) })
    expect(invoke.mock.calls).toEqual([
      [{ kind: 'query', id: 'filesystem.statInMount', payload: { uri, mountId: 'remote-mount' } }],
      [
        {
          kind: 'query',
          id: 'filesystem.readFileBytesInMount',
          payload: { uri, mountId: 'remote-mount' },
        },
      ],
    ])
    expect(readFileBytes).not.toHaveBeenCalled()
  })
})
