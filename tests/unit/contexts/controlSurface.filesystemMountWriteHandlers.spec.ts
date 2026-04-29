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
