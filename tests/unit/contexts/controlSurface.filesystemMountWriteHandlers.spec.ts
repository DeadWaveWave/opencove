import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerFilesystemMountWriteHandlers } from '../../../src/app/main/controlSurface/handlers/filesystemMountWriteHandlers'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import { createLocalFileSystemPort } from '../../../src/contexts/filesystem/infrastructure/localFileSystemPort'
import { toFileUri } from '../../../src/contexts/filesystem/domain/fileUri'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-04-25T00:00:00.000Z'),
}

describe('control surface filesystem mount write handlers', () => {
  it('uses the injected local delete implementation for mount deletes', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'opencove-test-mount-delete-'))
    const filePath = join(baseDir, 'delete-me.txt')
    await writeFile(filePath, 'keep until injected delete runs', 'utf8')

    const deleteEntry = vi.fn(async () => undefined)
    const controlSurface = createControlSurface()
    registerFilesystemMountWriteHandlers(controlSurface, {
      port: createLocalFileSystemPort(),
      topology: {
        resolveMountTarget: async () => ({
          mountId: 'mount-1',
          endpointId: 'local',
          targetId: 'target-1',
          rootPath: baseDir,
          rootUri: toFileUri(baseDir),
        }),
      } as unknown as WorkerTopologyStore,
      assertApprovedUri: async () => undefined,
      deleteEntry,
    })

    const uri = toFileUri(filePath)
    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'filesystem.deleteEntryInMount',
      payload: { mountId: 'mount-1', uri },
    })

    expect(result.ok).toBe(true)
    expect(deleteEntry).toHaveBeenCalledWith(uri)
    await expect(readFile(filePath, 'utf8')).resolves.toBe('keep until injected delete runs')
  })
})

it('rejects unknown strict mutation capability before dispatching to an older Worker', async () => {
  const support =
    await import('../../../src/app/main/controlSurface/handlers/filesystemMountSupport')
  const invokeRemote = vi
    .spyOn(support, 'invokeRemoteValue')
    .mockRejectedValue(new Error('Unknown query: filesystem.mutationCapabilities'))
  const control = createControlSurface()
  registerFilesystemMountWriteHandlers(control, {
    port: createLocalFileSystemPort(),
    topology: {
      resolveMountTarget: async () => ({
        mountId: 'remote',
        endpointId: 'remote-endpoint',
        rootUri: 'file:///remote',
      }),
    } as unknown as WorkerTopologyStore,
    assertApprovedUri: async () => undefined,
  })
  try {
    await Promise.all(
      [
        [
          'filesystem.writeFileTextInMount',
          { mountId: 'remote', uri: 'file:///remote/a', content: 'replace', overwrite: false },
        ],
        [
          'filesystem.deleteEntryInMount',
          { mountId: 'remote', uri: 'file:///remote/a', recursive: false },
        ],
      ].map(async ([id, payload]) => {
        const result = await control.invoke(ctx, { kind: 'command', id: id as string, payload })
        expect(result.ok).toBe(false)
      }),
    )
    expect(invokeRemote).toHaveBeenCalledTimes(2)
    expect(
      invokeRemote.mock.calls.every(
        ([request]) => request.id === 'filesystem.mutationCapabilities',
      ),
    ).toBe(true)
  } finally {
    invokeRemote.mockRestore()
  }
})

it('fences a retired plugin after the remote capability query and before mutation dispatch', async () => {
  const support =
    await import('../../../src/app/main/controlSurface/handlers/filesystemMountSupport')
  let finish!: (value: { exclusiveWrite: boolean; nonRecursiveDelete: boolean }) => void
  const invokeRemote = vi.spyOn(support, 'invokeRemoteValue').mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const control = createControlSurface()
  registerFilesystemMountWriteHandlers(control, {
    port: createLocalFileSystemPort(),
    topology: {
      resolveMountTarget: async () => ({
        mountId: 'remote',
        endpointId: 'endpoint',
        rootUri: 'file:///remote',
      }),
    } as unknown as WorkerTopologyStore,
    assertApprovedUri: async () => undefined,
  })
  let active = true
  const context = {
    ...ctx,
    assertActive: () => {
      if (!active) {
        throw new Error('Caller retired')
      }
    },
  }
  try {
    const pending = control.invoke(context, {
      kind: 'command',
      id: 'filesystem.writeFileTextInMount',
      payload: {
        mountId: 'remote',
        uri: 'file:///remote/a',
        content: 'should not write',
        overwrite: false,
      },
    })
    await vi.waitFor(() => expect(invokeRemote).toHaveBeenCalledTimes(1))
    active = false
    finish({ exclusiveWrite: true, nonRecursiveDelete: true })
    const result = await pending
    expect(result.ok).toBe(false)
    expect(invokeRemote).toHaveBeenCalledTimes(1)
    expect(invokeRemote.mock.calls[0][0].id).toBe('filesystem.mutationCapabilities')
  } finally {
    invokeRemote.mockRestore()
  }
})
