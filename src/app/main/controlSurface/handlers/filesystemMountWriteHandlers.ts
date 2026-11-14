import {
  filesystemCreateDirectoryInMountOperation,
  filesystemDeleteEntryInMountOperation,
  filesystemCopyEntryInMountOperation,
  filesystemMoveEntryInMountOperation,
  filesystemRenameEntryInMountOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/filesystem'
import { filesystemWriteFileTextInMountOperation } from '../../../../shared/contracts/controlSurface/operations/domains/filesystem'
import { registerOperation } from '../registerOperation'
import { assertRemoteMutationCapabilities } from './filesystemMutationCapabilities'
import type { FileSystemPort } from '../../../../contexts/filesystem/application'
import {
  copyEntryUseCase,
  createDirectoryUseCase,
  deleteEntryUseCase,
  moveEntryUseCase,
  renameEntryUseCase,
  writeFileTextUseCase,
} from '../../../../contexts/filesystem/application'
import type {
  CopyEntryInput,
  CreateDirectoryInput,
  DeleteEntryInput,
  MoveEntryInput,
  RenameEntryInput,
  WriteFileTextInput,
} from '../../../../shared/contracts/dto'
import type { ControlSurface } from '../controlSurface'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import {
  assertFileUriWithinMountRoot,
  invokeRemoteValue,
  resolveMountTargetOrThrow,
} from './filesystemMountSupport'
export function registerFilesystemMountWriteHandlers(
  controlSurface: ControlSurface,
  deps: {
    port: FileSystemPort
    topology: WorkerTopologyStore
    assertApprovedUri: (uri: string, debugMessage: string) => Promise<void>
    deleteEntry?: (uri: string) => Promise<void>
  },
): void {
  const deleteEntry =
    deps.deleteEntry ??
    (async (uri: string): Promise<void> => {
      await deleteEntryUseCase(deps.port, { uri })
    })

  registerOperation(controlSurface, filesystemWriteFileTextInMountOperation, {
    handle: async (ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await deps.assertApprovedUri(
          payload.uri,
          'filesystem.writeFileTextInMount uri is outside approved roots',
        )
      }

      assertFileUriWithinMountRoot({
        target,
        uri: payload.uri,
        debugMessage: 'filesystem.writeFileTextInMount uri is outside mount root',
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await writeFileTextUseCase(deps.port, payload satisfies WriteFileTextInput)
        return
      }

      if (payload.overwrite !== undefined) {
        await assertRemoteMutationCapabilities(deps.topology, target.endpointId)
      }
      ctx.assertActive?.()
      await invokeRemoteValue<void>({
        assertActive: ctx.assertActive,
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'filesystem.writeFileText',
        payload: {
          uri: payload.uri,
          content: payload.content,
          overwrite: payload.overwrite,
        } satisfies WriteFileTextInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, filesystemCreateDirectoryInMountOperation, {
    handle: async (ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await deps.assertApprovedUri(
          payload.uri,
          'filesystem.createDirectoryInMount uri is outside approved roots',
        )
      }

      assertFileUriWithinMountRoot({
        target,
        uri: payload.uri,
        debugMessage: 'filesystem.createDirectoryInMount uri is outside mount root',
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await createDirectoryUseCase(deps.port, payload satisfies CreateDirectoryInput)
        return
      }

      ctx.assertActive?.()
      await invokeRemoteValue<void>({
        assertActive: ctx.assertActive,
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'filesystem.createDirectory',
        payload: { uri: payload.uri } satisfies CreateDirectoryInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, filesystemDeleteEntryInMountOperation, {
    handle: async (ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await deps.assertApprovedUri(
          payload.uri,
          'filesystem.deleteEntryInMount uri is outside approved roots',
        )
      }

      assertFileUriWithinMountRoot({
        target,
        uri: payload.uri,
        debugMessage: 'filesystem.deleteEntryInMount uri is outside mount root',
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        if (payload.recursive !== undefined) {
          await deleteEntryUseCase(deps.port, payload)
        } else {
          await deleteEntry(payload.uri)
        }
        return
      }

      if (payload.recursive !== undefined) {
        await assertRemoteMutationCapabilities(deps.topology, target.endpointId)
      }
      ctx.assertActive?.()
      await invokeRemoteValue<void>({
        assertActive: ctx.assertActive,
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'filesystem.deleteEntry',
        payload: { uri: payload.uri, recursive: payload.recursive } satisfies DeleteEntryInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, filesystemCopyEntryInMountOperation, {
    handle: async (ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await deps.assertApprovedUri(
          payload.sourceUri,
          'filesystem.copyEntryInMount source is outside approved roots',
        )
        await deps.assertApprovedUri(
          payload.targetUri,
          'filesystem.copyEntryInMount target is outside approved roots',
        )
      }

      assertFileUriWithinMountRoot({
        target,
        uri: payload.sourceUri,
        debugMessage: 'filesystem.copyEntryInMount source is outside mount root',
      })
      assertFileUriWithinMountRoot({
        target,
        uri: payload.targetUri,
        debugMessage: 'filesystem.copyEntryInMount target is outside mount root',
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await copyEntryUseCase(deps.port, payload satisfies CopyEntryInput)
        return
      }

      ctx.assertActive?.()
      await invokeRemoteValue<void>({
        assertActive: ctx.assertActive,
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'filesystem.copyEntry',
        payload: {
          sourceUri: payload.sourceUri,
          targetUri: payload.targetUri,
        } satisfies CopyEntryInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, filesystemMoveEntryInMountOperation, {
    handle: async (ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await deps.assertApprovedUri(
          payload.sourceUri,
          'filesystem.moveEntryInMount source is outside approved roots',
        )
        await deps.assertApprovedUri(
          payload.targetUri,
          'filesystem.moveEntryInMount target is outside approved roots',
        )
      }

      assertFileUriWithinMountRoot({
        target,
        uri: payload.sourceUri,
        debugMessage: 'filesystem.moveEntryInMount source is outside mount root',
      })
      assertFileUriWithinMountRoot({
        target,
        uri: payload.targetUri,
        debugMessage: 'filesystem.moveEntryInMount target is outside mount root',
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await moveEntryUseCase(deps.port, payload satisfies MoveEntryInput)
        return
      }

      ctx.assertActive?.()
      await invokeRemoteValue<void>({
        assertActive: ctx.assertActive,
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'filesystem.moveEntry',
        payload: {
          sourceUri: payload.sourceUri,
          targetUri: payload.targetUri,
        } satisfies MoveEntryInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, filesystemRenameEntryInMountOperation, {
    handle: async (ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await deps.assertApprovedUri(
          payload.sourceUri,
          'filesystem.renameEntryInMount source is outside approved roots',
        )
        await deps.assertApprovedUri(
          payload.targetUri,
          'filesystem.renameEntryInMount target is outside approved roots',
        )
      }

      assertFileUriWithinMountRoot({
        target,
        uri: payload.sourceUri,
        debugMessage: 'filesystem.renameEntryInMount source is outside mount root',
      })
      assertFileUriWithinMountRoot({
        target,
        uri: payload.targetUri,
        debugMessage: 'filesystem.renameEntryInMount target is outside mount root',
      })

      if (target.endpointId === 'local') {
        ctx.assertActive?.()
        await renameEntryUseCase(deps.port, payload satisfies RenameEntryInput)
        return
      }

      ctx.assertActive?.()
      await invokeRemoteValue<void>({
        assertActive: ctx.assertActive,
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'filesystem.renameEntry',
        payload: {
          sourceUri: payload.sourceUri,
          targetUri: payload.targetUri,
        } satisfies RenameEntryInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })
}
