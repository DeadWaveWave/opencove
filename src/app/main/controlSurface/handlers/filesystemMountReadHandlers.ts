import { filesystemReadFileBytesInMountOperation } from '../../../../shared/contracts/controlSurface/operations/domains/filesystem'
import {
  filesystemReadDirectoryInMountOperation,
  filesystemReadFileTextInMountOperation,
  filesystemStatInMountOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/filesystem'
import { registerOperation } from '../registerOperation'
import type { FileSystemPort } from '../../../../contexts/filesystem/application/ports'
import {
  readDirectoryUseCase,
  readFileBytesUseCase,
  readFileTextUseCase,
  statUseCase,
} from '../../../../contexts/filesystem/application/usecases'
import type {
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInput,
  ReadFileTextResult,
  StatInput,
} from '../../../../shared/contracts/dto'
import { normalizeReadFileBytesResult } from '../../../../shared/contracts/dto/filesystemBytes'
import type { ControlSurface } from '../controlSurface'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import {
  assertFileUriWithinMountRoot,
  invokeRemoteValue,
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
  registerOperation(controlSurface, filesystemReadFileBytesInMountOperation, {
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

  registerOperation(controlSurface, filesystemReadFileTextInMountOperation, {
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
        payload: { uri: payload.uri, maxBytes: payload.maxBytes } satisfies ReadFileTextInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, filesystemStatInMountOperation, {
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

  registerOperation(controlSurface, filesystemReadDirectoryInMountOperation, {
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
        payload: { uri: payload.uri, maxEntries: payload.maxEntries } satisfies ReadDirectoryInput,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })
}
