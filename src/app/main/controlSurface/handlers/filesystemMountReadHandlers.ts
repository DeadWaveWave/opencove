import type { FileSystemPort } from '../../../../contexts/filesystem/application/ports'
import {
  readDirectoryUseCase,
  readFileBytesUseCase,
  readFileTextUseCase,
  statUseCase,
} from '../../../../contexts/filesystem/application/usecases'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  ReadDirectoryInMountInput,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInMountInput,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInMountInput,
  ReadFileTextInput,
  ReadFileTextResult,
  StatInMountInput,
  StatInput,
} from '../../../../shared/contracts/dto'
import { normalizeReadFileBytesResult } from '../../../../shared/contracts/dto/filesystemBytes'
import type { ControlSurface } from '../controlSurface'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import {
  assertFileUriWithinMountRoot,
  invokeRemoteValue,
  isRecord,
  normalizeFileSystemUri,
  normalizeMountId,
  resolveMountTargetOrThrow,
} from './filesystemMountSupport'

export function registerFilesystemMountReadHandlers(
  controlSurface: ControlSurface,
  deps: {
    port: FileSystemPort
    topology: WorkerTopologyStore
    assertApprovedUri: (uri: string, debugMessage: string) => Promise<void>
  },
): void {
  controlSurface.register('filesystem.readFileBytesInMount', {
    kind: 'query',
    validate: (payload: unknown): ReadFileBytesInMountInput => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for filesystem.readFileBytesInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'filesystem.readFileBytesInMount'),
        uri: normalizeFileSystemUri(payload.uri, 'filesystem.readFileBytesInMount'),
      }
    },
    handle: async (_ctx, payload): Promise<ReadFileBytesResult> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        await deps.assertApprovedUri(
          payload.uri,
          'filesystem.readFileBytesInMount uri is outside approved roots',
        )
      }

      assertFileUriWithinMountRoot({
        target,
        uri: payload.uri,
        debugMessage: 'filesystem.readFileBytesInMount uri is outside mount root',
      })

      if (target.endpointId === 'local') {
        return await readFileBytesUseCase(deps.port, payload satisfies ReadFileBytesInput)
      }

      const result = await invokeRemoteValue<unknown>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'query',
        id: 'filesystem.readFileBytes',
        payload: { uri: payload.uri } satisfies ReadFileBytesInput,
      })

      return normalizeReadFileBytesResult(result, 'filesystem.readFileBytes')
    },
    defaultErrorCode: 'filesystem.read_file_bytes_failed',
  })

  controlSurface.register('filesystem.readFileTextInMount', {
    kind: 'query',
    validate: (payload: unknown): ReadFileTextInMountInput => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for filesystem.readFileTextInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'filesystem.readFileTextInMount'),
        uri: normalizeFileSystemUri(payload.uri, 'filesystem.readFileTextInMount'),
      }
    },
    handle: async (_ctx, payload): Promise<ReadFileTextResult> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        await deps.assertApprovedUri(
          payload.uri,
          'filesystem.readFileTextInMount uri is outside approved roots',
        )
      }

      assertFileUriWithinMountRoot({
        target,
        uri: payload.uri,
        debugMessage: 'filesystem.readFileTextInMount uri is outside mount root',
      })

      if (target.endpointId === 'local') {
        return await readFileTextUseCase(deps.port, payload satisfies ReadFileTextInput)
      }

      return await invokeRemoteValue<ReadFileTextResult>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'query',
        id: 'filesystem.readFileText',
        payload: { uri: payload.uri } satisfies ReadFileTextInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.statInMount', {
    kind: 'query',
    validate: (payload: unknown): StatInMountInput => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for filesystem.statInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'filesystem.statInMount'),
        uri: normalizeFileSystemUri(payload.uri, 'filesystem.statInMount'),
      }
    },
    handle: async (_ctx, payload) => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        await deps.assertApprovedUri(
          payload.uri,
          'filesystem.statInMount uri is outside approved roots',
        )
      }

      assertFileUriWithinMountRoot({
        target,
        uri: payload.uri,
        debugMessage: 'filesystem.statInMount uri is outside mount root',
      })

      if (target.endpointId === 'local') {
        return await statUseCase(deps.port, payload satisfies StatInput)
      }

      return await invokeRemoteValue({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'query',
        id: 'filesystem.stat',
        payload: { uri: payload.uri } satisfies StatInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.readDirectoryInMount', {
    kind: 'query',
    validate: (payload: unknown): ReadDirectoryInMountInput => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for filesystem.readDirectoryInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'filesystem.readDirectoryInMount'),
        uri: normalizeFileSystemUri(payload.uri, 'filesystem.readDirectoryInMount'),
      }
    },
    handle: async (_ctx, payload): Promise<ReadDirectoryResult> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        await deps.assertApprovedUri(
          payload.uri,
          'filesystem.readDirectoryInMount uri is outside approved roots',
        )
      }

      assertFileUriWithinMountRoot({
        target,
        uri: payload.uri,
        debugMessage: 'filesystem.readDirectoryInMount uri is outside mount root',
      })

      if (target.endpointId === 'local') {
        return await readDirectoryUseCase(deps.port, payload satisfies ReadDirectoryInput)
      }

      return await invokeRemoteValue<ReadDirectoryResult>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'query',
        id: 'filesystem.readDirectory',
        payload: { uri: payload.uri } satisfies ReadDirectoryInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })
}
