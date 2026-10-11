// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canOpenSystemFile,
  openSystemFile,
} from '../../../src/contexts/workspace/presentation/renderer/utils/systemFileOpening'

const reference = { uri: 'file:///repo/file%20name.bin', mountId: 'mount' }

function installApi(
  options: {
    runtime?: 'electron' | 'browser'
    mode?: unknown
    endpointId?: string
  } = {},
) {
  const openPath = vi.fn(async () => undefined)
  const stat = vi.fn(async () => ({ kind: 'file' }))
  const invoke = vi.fn(async (request: { id: string }) =>
    request.id === 'mountTarget.resolve'
      ? { mountId: 'mount', endpointId: options.endpointId ?? 'local' }
      : { kind: 'file' },
  )
  const getConfig = vi.fn(async () => ({ mode: options.mode ?? 'local' }))
  vi.stubGlobal('window', {
    opencoveApi: {
      meta: { runtime: options.runtime ?? 'electron', platform: 'darwin' },
      workspace: { openPath },
      workerClient: { getConfig },
      filesystem: { stat },
      controlSurface: { invoke },
    },
  })
  return { openPath, stat, invoke, getConfig }
}

afterEach(() => vi.unstubAllGlobals())

describe('system file opening', () => {
  it('opens an approved root-local file using its decoded path', async () => {
    const { openPath, stat, invoke } = installApi()
    const rootReference = { ...reference, mountId: null }
    await expect(canOpenSystemFile(rootReference)).resolves.toBe(true)
    await expect(openSystemFile(rootReference)).resolves.toBe(true)
    expect(stat).toHaveBeenCalledExactlyOnceWith({ uri: reference.uri })
    expect(invoke).not.toHaveBeenCalled()
    expect(openPath).toHaveBeenCalledExactlyOnceWith({
      path: '/repo/file name.bin',
      openerId: 'finder',
    })
  })

  it('resolves and verifies a local source mount without falling back to local stat', async () => {
    const { openPath, stat, invoke } = installApi()
    await expect(openSystemFile(reference)).resolves.toBe(true)
    expect(invoke.mock.calls).toEqual([
      [{ kind: 'query', id: 'mountTarget.resolve', payload: { mountId: 'mount' } }],
      [
        {
          kind: 'query',
          id: 'filesystem.statInMount',
          payload: { mountId: 'mount', uri: reference.uri },
        },
      ],
    ])
    expect(stat).not.toHaveBeenCalled()
    expect(openPath).toHaveBeenCalledOnce()
  })

  it.each([
    { runtime: 'browser' as const },
    { mode: 'remote' },
    { mode: 'unknown' },
    { endpointId: 'remote' },
  ])('does not open a source owned outside this desktop: %j', async options => {
    const { openPath, stat } = installApi(options)
    await expect(canOpenSystemFile(reference)).resolves.toBe(false)
    await expect(openSystemFile(reference)).resolves.toBe(false)
    expect(openPath).not.toHaveBeenCalled()
    expect(stat).not.toHaveBeenCalled()
  })

  it('does not assume a missing mount or failed HomeWorker query is local', async () => {
    const { getConfig, invoke, openPath } = installApi()
    invoke.mockRejectedValue(new Error('Missing mount'))
    await expect(openSystemFile(reference)).resolves.toBe(false)
    getConfig.mockRejectedValue(new Error('Unavailable'))
    await expect(openSystemFile({ ...reference, mountId: null })).resolves.toBe(false)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('rejects a mount resolution belonging to a different source', async () => {
    const { invoke, openPath } = installApi()
    invoke.mockResolvedValueOnce({ mountId: 'other-mount', endpointId: 'local' })
    await expect(openSystemFile(reference)).resolves.toBe(false)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('does not stat or open after its source changes during mount resolution', async () => {
    const { invoke, stat, openPath } = installApi()
    let completeMount!: (value: { mountId: string; endpointId: string }) => void
    invoke.mockReturnValueOnce(
      new Promise(resolve => {
        completeMount = resolve
      }),
    )
    let current = true
    const opening = openSystemFile(reference, () => current)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    current = false
    completeMount({ mountId: 'mount', endpointId: 'local' })
    await expect(opening).resolves.toBe(false)
    expect(invoke).toHaveBeenCalledOnce()
    expect(stat).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
  })

  it.each(['https://example.com/a.bin', 'file:///repo/%invalid', 'file://remote/repo/a.bin'])(
    'rejects an invalid or foreign file URI: %s',
    async uri => {
      const { openPath } = installApi()
      await expect(openSystemFile({ uri, mountId: null })).resolves.toBe(false)
      expect(openPath).not.toHaveBeenCalled()
    },
  )

  it('does not open after the caller invalidates its source during the stat await', async () => {
    const { openPath, stat } = installApi()
    let completeStat!: (value: { kind: string }) => void
    stat.mockReturnValue(
      new Promise(resolve => {
        completeStat = resolve
      }),
    )
    let current = true
    const opening = openSystemFile({ ...reference, mountId: null }, () => current)
    await vi.waitFor(() => expect(stat).toHaveBeenCalledOnce())
    current = false
    completeStat({ kind: 'file' })
    await expect(opening).resolves.toBe(false)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('keeps failed file-scope and native path approvals visible to the caller', async () => {
    const { stat, openPath } = installApi()
    const failure = new Error('Not approved')
    stat.mockRejectedValueOnce(failure)
    await expect(openSystemFile({ ...reference, mountId: null })).rejects.toBe(failure)
    expect(openPath).not.toHaveBeenCalled()
    openPath.mockRejectedValueOnce(failure)
    await expect(openSystemFile({ ...reference, mountId: null })).rejects.toBe(failure)
    expect(openPath).toHaveBeenCalledOnce()
  })
})
