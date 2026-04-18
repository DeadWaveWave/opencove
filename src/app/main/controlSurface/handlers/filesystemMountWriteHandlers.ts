import { fileURLToPath } from 'node:url'
import { shell } from 'electron'
import type { FileSystemPort } from '../../../../contexts/filesystem/application/ports'
import {
  copyEntryUseCase,
  createDirectoryUseCase,
  moveEntryUseCase,
  renameEntryUseCase,
  writeFileTextUseCase,
} from '../../../../contexts/filesystem/application/usecases'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  CopyEntryInMountInput,
  CopyEntryInput,
  CreateDirectoryInMountInput,
  CreateDirectoryInput,
  DeleteEntryInMountInput,
  DeleteEntryInput,
  MoveEntryInMountInput,
  MoveEntryInput,
  RenameEntryInMountInput,
  RenameEntryInput,
  WriteFileTextInMountInput,
  WriteFileTextInput,
} from '../../../../shared/contracts/dto'
import type { ControlSurface } from '../controlSurface'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import {
  assertFileUriWithinMountRoot,
  invokeRemoteValue,
  isRecord,
  normalizeFileSystemUri,
  normalizeMountId,
  normalizeSourceTargetPayload,
  resolveMountTargetOrThrow,
} from './filesystemMountSupport'

export function registerFilesystemMountWriteHandlers(
  controlSurface: ControlSurface,
  deps: {
    port: FileSystemPort
    topology: WorkerTopologyStore
    assertApprovedUri: (uri: string, debugMessage: string) => Promise<void>
  },
): void {
  controlSurface.register('filesystem.writeFileTextInMount', {
    kind: 'command',
    validate: (payload: unknown): WriteFileTextInMountInput => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for filesystem.writeFileTextInMount.',
        })
      }

      const content = payload.content
      if (typeof content !== 'string') {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for filesystem.writeFileTextInMount content.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'filesystem.writeFileTextInMount'),
        uri: normalizeFileSystemUri(payload.uri, 'filesystem.writeFileTextInMount'),
        content,
      }
    },
    handle: async (_ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
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
        await writeFileTextUseCase(deps.port, payload satisfies WriteFileTextInput)
        return
      }

      await invokeRemoteValue<void>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'filesystem.writeFileText',
        payload: { uri: payload.uri, content: payload.content } satisfies WriteFileTextInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.createDirectoryInMount', {
    kind: 'command',
    validate: (payload: unknown): CreateDirectoryInMountInput => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for filesystem.createDirectoryInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'filesystem.createDirectoryInMount'),
        uri: normalizeFileSystemUri(payload.uri, 'filesystem.createDirectoryInMount'),
      }
    },
    handle: async (_ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
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
        await createDirectoryUseCase(deps.port, payload satisfies CreateDirectoryInput)
        return
      }

      await invokeRemoteValue<void>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'filesystem.createDirectory',
        payload: { uri: payload.uri } satisfies CreateDirectoryInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.deleteEntryInMount', {
    kind: 'command',
    validate: (payload: unknown): DeleteEntryInMountInput => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for filesystem.deleteEntryInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'filesystem.deleteEntryInMount'),
        uri: normalizeFileSystemUri(payload.uri, 'filesystem.deleteEntryInMount'),
      }
    },
    handle: async (_ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
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
        await shell.trashItem(fileURLToPath(payload.uri))
        return
      }

      await invokeRemoteValue<void>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'filesystem.deleteEntry',
        payload: { uri: payload.uri } satisfies DeleteEntryInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.copyEntryInMount', {
    kind: 'command',
    validate: payload =>
      normalizeSourceTargetPayload<CopyEntryInMountInput>(payload, 'filesystem.copyEntryInMount'),
    handle: async (_ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
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
        await copyEntryUseCase(deps.port, payload satisfies CopyEntryInput)
        return
      }

      await invokeRemoteValue<void>({
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

  controlSurface.register('filesystem.moveEntryInMount', {
    kind: 'command',
    validate: payload =>
      normalizeSourceTargetPayload<MoveEntryInMountInput>(payload, 'filesystem.moveEntryInMount'),
    handle: async (_ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
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
        await moveEntryUseCase(deps.port, payload satisfies MoveEntryInput)
        return
      }

      await invokeRemoteValue<void>({
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

  controlSurface.register('filesystem.renameEntryInMount', {
    kind: 'command',
    validate: payload =>
      normalizeSourceTargetPayload<RenameEntryInMountInput>(
        payload,
        'filesystem.renameEntryInMount',
      ),
    handle: async (_ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
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
        await renameEntryUseCase(deps.port, payload satisfies RenameEntryInput)
        return
      }

      await invokeRemoteValue<void>({
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
