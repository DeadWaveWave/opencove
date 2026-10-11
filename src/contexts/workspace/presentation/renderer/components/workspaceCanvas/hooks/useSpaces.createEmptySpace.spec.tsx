import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MountDto } from '@shared/contracts/dto'
import type { WorkspaceSpaceState } from '../../../types'
import { useCreateEmptySpace } from './useSpaces.createEmptySpace'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => vi.unstubAllGlobals())
const remoteMount: MountDto = {
  mountId: 'remote-mount',
  projectId: 'project',
  endpointId: 'remote-worker',
  targetId: 'remote-target',
  rootPath: '/remote/repository',
  rootUri: 'file:///remote/repository',
  name: 'Remote',
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
}

function setup(invoke = vi.fn().mockResolvedValue({ mounts: [remoteMount] })) {
  vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
  const spacesRef = { current: [] as WorkspaceSpaceState[] }
  const options: Parameters<typeof useCreateEmptySpace>[0] = {
    workspaceId: 'project',
    workspacePath: '/local/metadata/projects/project',
    standardWindowSizeBucket: 'regular',
    nodesRef: { current: [] },
    spacesRef,
    onSpacesChange: vi.fn(),
    onRequestPersistFlush: vi.fn(),
    setContextMenu: vi.fn(),
    setEmptySelectionPrompt: vi.fn(),
    setSpaceTargetMountPicker: vi.fn(),
    cancelSpaceRename: vi.fn(),
    onShowMessage: vi.fn(),
    resolveDefaultSpaceName: () => 'Space 1',
  }
  return { options, invoke, spacesRef }
}

describe('new empty Space location', () => {
  it.each(['remote-worker', 'local'])(
    'persists the default %s mount instead of project metadata',
    async endpointId => {
      const { options, invoke, spacesRef } = setup(
        vi.fn().mockResolvedValue({
          mounts: [{ ...remoteMount, endpointId }],
        }),
      )
      const { result } = renderHook(() => useCreateEmptySpace(options))
      let id: string | null = null
      await act(async () => {
        id = await result.current({ x: 300, y: 300 })
      })
      expect(id).toEqual(expect.any(String))
      expect(spacesRef.current).toEqual([
        expect.objectContaining({
          id,
          directoryPath: remoteMount.rootPath,
          targetMountId: remoteMount.mountId,
        }),
      ])
      expect(invoke).toHaveBeenCalledExactlyOnceWith({
        kind: 'query',
        id: 'mount.list',
        payload: { projectId: 'project' },
      })
      expect(options.onRequestPersistFlush).toHaveBeenCalledOnce()
    },
  )

  it.each([[], null])(
    'does not create a Space on missing or failed mount lookup (%j)',
    async mounts => {
      const invoke =
        mounts === null
          ? vi.fn().mockRejectedValue(new Error('disconnected'))
          : vi.fn().mockResolvedValue({ mounts })
      const { options, spacesRef } = setup(invoke)
      const { result } = renderHook(() => useCreateEmptySpace(options))
      await act(async () => {
        expect(await result.current({ x: 0, y: 0 })).toBeNull()
      })
      expect(spacesRef.current).toEqual([])
      expect(options.onSpacesChange).not.toHaveBeenCalled()
      expect(options.onShowMessage).toHaveBeenCalledWith('messages.mountListFailed', 'error')
    },
  )

  it.each(['unmount', 'project-switch'])('rejects stale resolution after %s', async transition => {
    let resolve!: (value: { mounts: MountDto[] }) => void
    const pending = new Promise<{ mounts: MountDto[] }>(done => {
      resolve = done
    })
    const { options, spacesRef } = setup(vi.fn().mockReturnValue(pending))
    const { result, rerender, unmount } = renderHook(props => useCreateEmptySpace(props), {
      initialProps: options,
    })
    const creation = result.current({ x: 0, y: 0 })
    if (transition === 'unmount') {
      unmount()
    } else {
      rerender({ ...options, workspaceId: 'next-project' })
    }
    await act(async () => {
      resolve({ mounts: [remoteMount] })
      expect(await creation).toBeNull()
    })
    expect(spacesRef.current).toEqual([])
    expect(options.onSpacesChange).not.toHaveBeenCalled()
    expect(options.onRequestPersistFlush).not.toHaveBeenCalled()
  })
})
