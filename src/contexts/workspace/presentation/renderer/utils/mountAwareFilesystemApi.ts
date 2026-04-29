import type {
  CopyEntryInput,
  CreateDirectoryInput,
  DeleteEntryInput,
  FileSystemStat,
  MoveEntryInput,
  ReadDirectoryResult,
  ReadFileBytesResult,
  ReadFileTextResult,
  RenameEntryInput,
  StatInput,
  WriteFileTextInput,
} from '@shared/contracts/dto'

export interface MountAwareFilesystemApi {
  copyEntry: (payload: CopyEntryInput) => Promise<void>
  createDirectory: (payload: CreateDirectoryInput) => Promise<void>
  deleteEntry: (payload: DeleteEntryInput) => Promise<void>
  moveEntry: (payload: MoveEntryInput) => Promise<void>
  readDirectory: (payload: { uri: string }) => Promise<ReadDirectoryResult>
  readFileBytes?: (payload: { uri: string }) => Promise<ReadFileBytesResult>
  readFileText: (payload: { uri: string }) => Promise<ReadFileTextResult>
  renameEntry: (payload: RenameEntryInput) => Promise<void>
  stat: (payload: StatInput) => Promise<FileSystemStat>
  writeFileText: (payload: WriteFileTextInput) => Promise<void>
}

function normalizeReadFileBytesResult(result: unknown): ReadFileBytesResult {
  if (
    result &&
    typeof result === 'object' &&
    'bytes' in result &&
    (result as { bytes: unknown }).bytes instanceof Uint8Array
  ) {
    return result as ReadFileBytesResult
  }

  const rawBytes =
    result && typeof result === 'object' && 'bytes' in result
      ? (result as { bytes: unknown }).bytes
      : null

  if (Array.isArray(rawBytes)) {
    return {
      bytes: Uint8Array.from(rawBytes),
    }
  }

  if (rawBytes && typeof rawBytes === 'object') {
    const numericValues = Object.entries(rawBytes as Record<string, unknown>)
      .sort((left, right) => Number(left[0]) - Number(right[0]))
      .map(([, value]) => Number(value))

    return {
      bytes: Uint8Array.from(numericValues),
    }
  }

  throw new Error('Invalid binary file payload.')
}

function resolveControlSurfaceInvoke(): ((request: unknown) => Promise<unknown>) | null {
  const invoke = (window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } })
    .opencoveApi?.controlSurface?.invoke

  return typeof invoke === 'function' ? (invoke as (request: unknown) => Promise<unknown>) : null
}

export function resolveFilesystemApiForMount(
  mountId: string | null,
): MountAwareFilesystemApi | null {
  const controlSurfaceInvoke = resolveControlSurfaceInvoke()

  if (mountId && controlSurfaceInvoke) {
    return {
      stat: async ({ uri }) =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'query',
          id: 'filesystem.statInMount',
          payload: { mountId, uri },
        }),
      readFileBytes: async ({ uri }) =>
        normalizeReadFileBytesResult(
          await window.opencoveApi.controlSurface.invoke({
            kind: 'query',
            id: 'filesystem.readFileBytesInMount',
            payload: { mountId, uri },
          }),
        ),
      readFileText: async ({ uri }) =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'query',
          id: 'filesystem.readFileTextInMount',
          payload: { mountId, uri },
        }),
      writeFileText: async ({ uri, content }) => {
        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'filesystem.writeFileTextInMount',
          payload: { mountId, uri, content },
        })
      },
      readDirectory: async ({ uri }) =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'query',
          id: 'filesystem.readDirectoryInMount',
          payload: { mountId, uri },
        }),
      createDirectory: async ({ uri }) => {
        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'filesystem.createDirectoryInMount',
          payload: { mountId, uri },
        })
      },
      deleteEntry: async ({ uri }) => {
        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'filesystem.deleteEntryInMount',
          payload: { mountId, uri },
        })
      },
      copyEntry: async ({ sourceUri, targetUri }) => {
        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'filesystem.copyEntryInMount',
          payload: { mountId, sourceUri, targetUri },
        })
      },
      moveEntry: async ({ sourceUri, targetUri }) => {
        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'filesystem.moveEntryInMount',
          payload: { mountId, sourceUri, targetUri },
        })
      },
      renameEntry: async ({ sourceUri, targetUri }) => {
        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'filesystem.renameEntryInMount',
          payload: { mountId, sourceUri, targetUri },
        })
      },
    }
  }

  return window.opencoveApi?.filesystem ?? null
}
