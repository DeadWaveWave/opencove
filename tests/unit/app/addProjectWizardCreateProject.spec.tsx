import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAddProjectWizardCreateProject } from '../../../src/app/renderer/shell/components/addProjectWizard/useAddProjectWizardCreateProject'

describe('useAddProjectWizardCreateProject', () => {
  const invoke = vi.fn()

  beforeEach(() => {
    invoke.mockReset()
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { controlSurface: { invoke } },
    })
  })

  it('rolls back every mount created before a later mount fails', async () => {
    invoke.mockImplementation(
      async ({ id, payload }: { id: string; payload: { rootPath?: string; mountId?: string } }) => {
        if (id === 'mount.create' && payload.rootPath === '/project') {
          return { mount: { mountId: 'mount-created-first' } }
        }
        if (id === 'mount.create' && payload.rootPath === '/remote/project') {
          throw new Error('second mount failed')
        }
        if (id === 'mount.remove' && payload.mountId === 'mount-created-first') {
          return { removed: true }
        }
        throw new Error(`Unexpected request: ${id}`)
      },
    )
    const setError = vi.fn()
    const onClose = vi.fn()
    const { result } = renderHook(() =>
      useAddProjectWizardCreateProject({
        t: key => key,
        existingWorkspaces: [],
        onClose,
        isBusy: false,
        setIsBusy: vi.fn(),
        setError,
        derivedProjectName: 'project',
        defaultLocationKind: 'local',
        defaultLocalRootPath: '/project',
        defaultLocalMountName: 'project',
        defaultRemoteEndpointId: '',
        defaultRemoteRootPath: '',
        defaultRemoteMountName: '',
        extraMounts: [
          {
            id: 'draft-remote',
            endpointId: 'remote-1',
            rootPath: '/remote/project',
            name: 'remote project',
          },
        ],
      }),
    )

    await act(async () => {
      await result.current()
    })

    expect(invoke).toHaveBeenCalledWith({
      kind: 'command',
      id: 'mount.remove',
      payload: { mountId: 'mount-created-first' },
    })
    expect(setError).toHaveBeenLastCalledWith('second mount failed')
    expect(onClose).not.toHaveBeenCalled()
  })
})
