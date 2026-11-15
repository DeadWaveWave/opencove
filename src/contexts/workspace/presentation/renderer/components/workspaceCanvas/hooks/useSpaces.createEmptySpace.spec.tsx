import { act, renderHook } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { MountDto } from '@shared/contracts/dto'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { WorkspaceState } from '../../../types'
import { registerWorkspaceDocumentPersistFlush } from '../../../store/workspaceDocumentCommands'
import { useCreateEmptySpace } from './useSpaces.createEmptySpace'
import { CanvasStoreTestProvider } from '../../../../../../../../tests/support/canvasStoreTestHarness'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

let flush: Mock<() => void>
let storeWrites: Mock<() => void>
let disposers: Array<() => void> = []

// The hook reads and writes the committed document of workspace `project`.
beforeEach(() => {
  useAppStore.setState({
    workspaces: [
      {
        id: 'project',
        name: 'Project',
        path: '/local/metadata/projects/project',
        worktreesRoot: '',
        nodes: [],
        spaces: [],
        activeSpaceId: null,
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: false,
      } as WorkspaceState,
    ],
    activeWorkspaceId: 'project',
  })
  flush = vi.fn()
  storeWrites = vi.fn()
  disposers = [registerWorkspaceDocumentPersistFlush(flush), useAppStore.subscribe(storeWrites)]
})

afterEach(() => {
  disposers.forEach(dispose => dispose())
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null })
  vi.unstubAllGlobals()
})

function readStoreSpaces() {
  return useAppStore.getState().workspaces[0].spaces
}

function ProjectStore({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <CanvasStoreTestProvider workspaceId="project">{children}</CanvasStoreTestProvider>
}
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
  const options: Parameters<typeof useCreateEmptySpace>[0] = {
    workspaceId: 'project',
    workspacePath: '/local/metadata/projects/project',
    standardWindowSizeBucket: 'regular',
    onShowMessage: vi.fn(),
    resolveDefaultSpaceName: () => 'Space 1',
  }
  return { options, invoke }
}

describe('new empty Space location', () => {
  it.each(['remote-worker', 'local'])(
    'persists the default %s mount instead of project metadata',
    async endpointId => {
      const { options, invoke } = setup(
        vi.fn().mockResolvedValue({
          mounts: [{ ...remoteMount, endpointId }],
        }),
      )
      const { result } = renderHook(() => useCreateEmptySpace(options), {
        wrapper: ProjectStore,
      })
      let id: string | null = null
      await act(async () => {
        id = await result.current({ x: 300, y: 300 })
      })
      expect(id).toEqual(expect.any(String))
      expect(readStoreSpaces()).toEqual([
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
      expect(flush).toHaveBeenCalledOnce()
    },
  )

  it.each([[], null])(
    'does not create a Space on missing or failed mount lookup (%j)',
    async mounts => {
      const invoke =
        mounts === null
          ? vi.fn().mockRejectedValue(new Error('disconnected'))
          : vi.fn().mockResolvedValue({ mounts })
      const { options } = setup(invoke)
      const { result } = renderHook(() => useCreateEmptySpace(options), {
        wrapper: ProjectStore,
      })
      await act(async () => {
        expect(await result.current({ x: 0, y: 0 })).toBeNull()
      })
      expect(readStoreSpaces()).toEqual([])
      expect(storeWrites).not.toHaveBeenCalled()
      expect(options.onShowMessage).toHaveBeenCalledWith('messages.mountListFailed', 'error')
    },
  )

  it.each(['unmount', 'project-switch'])('rejects stale resolution after %s', async transition => {
    let resolve!: (value: { mounts: MountDto[] }) => void
    const pending = new Promise<{ mounts: MountDto[] }>(done => {
      resolve = done
    })
    const { options } = setup(vi.fn().mockReturnValue(pending))
    const { result, rerender, unmount } = renderHook(props => useCreateEmptySpace(props), {
      initialProps: options,
      wrapper: ProjectStore,
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
    expect(readStoreSpaces()).toEqual([])
    expect(storeWrites).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })
})
