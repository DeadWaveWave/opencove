import { randomUUID } from 'node:crypto'
import {
  PluginFileWatches,
  type PluginFileSample,
} from '../../../../contexts/plugins/application/PluginFileWatches'
import type {
  PluginHostAuthority,
  PluginResolvedTarget,
} from '../../../../contexts/plugins/domain/pluginHostTypes'
import {
  pluginRecord,
  pluginString,
} from '../../../../contexts/plugins/domain/localPluginValidation'
import { pluginJsonValue } from '../../../../contexts/plugins/domain/pluginJsonValue'
import type {
  FileSystemStat,
  ReadDirectoryResult,
  ReadFileTextResult,
} from '../../../../shared/contracts/dto'
import { assertFileUriWithinRootUri } from '../topology/fileUriScope'
import { pluginRelativeUri } from './pluginTargetResolution'

interface Dependencies {
  invoke<T>(
    id: string,
    kind: 'query' | 'command',
    payload: unknown,
    assertActive?: () => void,
  ): Promise<T>
  resolve(value: unknown): Promise<PluginResolvedTarget>
  revalidate(target: PluginResolvedTarget): Promise<void>
}
function fields(payload: unknown, allowed: string[]) {
  const value = pluginRecord(payload)
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error('Unsupported filesystem argument.')
  }
  return value
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Explicit ${name} boolean is required.`)
  }
  return value
}
function relativePath(value: unknown): string {
  if (value === undefined) {
    return '.'
  }
  if (typeof value !== 'string' || !value.length || value.length > 4096) {
    throw new Error('Invalid plugin relative path.')
  }
  return value
}
function uriFor(target: PluginResolvedTarget, path: unknown, mutation = false): string {
  const uri = pluginRelativeUri(target, path)
  assertFileUriWithinRootUri({
    rootUri: target.rootUri,
    uri,
    debugMessage: 'Plugin file path is outside target scope.',
  })
  if (mutation && uri.replace(/\/$/, '') === target.cwdUri.replace(/\/$/, '')) {
    throw new Error('Cannot mutate the target working directory itself.')
  }
  return uri
}

export function createPluginFilesystemHandlers(deps: Dependencies) {
  const stat = (target: PluginResolvedTarget, uri: string) =>
    deps.invoke<FileSystemStat>('filesystem.statInMount', 'query', { mountId: target.mountId, uri })
  const sample = async (
    target: PluginResolvedTarget,
    path: string,
    assertActive: () => void,
  ): Promise<PluginFileSample> => {
    await deps.revalidate(target)
    assertActive()
    const uri = uriFor(target, path)
    const info = await stat(target, uri)
    assertActive()
    const normalized =
      path
        .replace(/\\/g, '/')
        .split('/')
        .filter(p => p && p !== '.')
        .join('/') || '.'
    const output: PluginFileSample = new Map([
      [normalized, JSON.stringify([info.kind, info.sizeBytes, info.mtimeMs])],
    ])
    if (info.kind === 'directory') {
      const listing = await deps.invoke<ReadDirectoryResult>(
        'filesystem.readDirectoryInMount',
        'query',
        { mountId: target.mountId, uri, maxEntries: 256 },
      )
      assertActive()
      if (listing.truncated || listing.entries.length > 256) {
        throw new Error(
          'File watches support at most 256 immediate entries; select a smaller directory.',
        )
      }
      // Four provider requests at a time, also across remote endpoints.
      for (let i = 0; i < listing.entries.length; i += 4) {
        // Bound concurrent provider requests to four, including over remote HTTP.
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(
          listing.entries.slice(i, i + 4).map(async entry => {
            assertActive()
            if (entry.kind === 'unknown') {
              return
            } // symlinks / provider-specific entries are not followed
            const child = normalized === '.' ? entry.name : `${normalized}/${entry.name}`
            const childStat = await stat(target, uriFor(target, child))
            assertActive()
            output.set(
              child,
              JSON.stringify([childStat.kind, childStat.sizeBytes, childStat.mtimeMs]),
            )
          }),
        )
      }
    }
    await deps.revalidate(target)
    assertActive()
    return output
  }
  const watches = new PluginFileWatches({ sample }, randomUUID)
  const request = async (
    authority: PluginHostAuthority,
    operation: string,
    payload: unknown,
  ): Promise<unknown> => {
    if (operation === 'filesystem.readWatch' || operation === 'filesystem.unwatch') {
      const input = fields(payload, ['watchId'])
      const id = pluginString(input.watchId, 'watchId', 100)
      return operation === 'filesystem.readWatch'
        ? watches.read(authority, id)
        : watches.remove(authority, id)
    }
    const extras: Record<string, string[]> = {
      'filesystem.stat': [],
      'filesystem.readDirectory': [],
      'filesystem.readText': [],
      'filesystem.watch': [],
      'filesystem.writeText': ['content', 'overwrite'],
      'filesystem.mkdir': [],
      'filesystem.rename': ['newPath'],
      'filesystem.delete': ['recursive'],
    }
    if (!(operation in extras)) {
      throw new Error('Unsupported plugin filesystem operation.')
    }
    const input = fields(payload, ['target', 'path', ...extras[operation]])
    const target = await deps.resolve(input.target)
    authority.assertActive()
    const mutation = [
      'filesystem.writeText',
      'filesystem.mkdir',
      'filesystem.rename',
      'filesystem.delete',
    ].includes(operation)
    if (mutation && input.path === undefined) {
      throw new Error('File mutations require an explicit relative path.')
    }
    const uri = uriFor(target, input.path, mutation)
    await deps.revalidate(target)
    authority.assertActive()
    const mountInput = { mountId: target.mountId, uri }
    const mutate = (id: string, mutationPayload: unknown) =>
      deps.invoke(id, 'command', mutationPayload, authority.assertActive)
    if (operation === 'filesystem.watch') {
      return watches.create(authority, target, relativePath(input.path))
    }
    if (operation === 'filesystem.stat') {
      return { target, stat: await stat(target, uri) }
    }
    if (operation === 'filesystem.readDirectory') {
      const result = await deps.invoke<ReadDirectoryResult>(
        'filesystem.readDirectoryInMount',
        'query',
        { ...mountInput, maxEntries: 1000 },
      )
      return pluginJsonValue(
        {
          target,
          entries: result.entries.slice(0, 1000),
          truncated: result.truncated === true || result.entries.length > 1000,
        },
        1024 * 1024,
        'directory response',
      )
    }
    if (operation === 'filesystem.readText') {
      const info = await stat(target, uri)
      authority.assertActive()
      if (info.kind !== 'file' || info.sizeBytes === null || info.sizeBytes > 1024 * 1024) {
        throw new Error('Plugin text reads require a regular file no larger than 1 MiB.')
      }
      const result = await deps.invoke<ReadFileTextResult>(
        'filesystem.readFileTextInMount',
        'query',
        { ...mountInput, maxBytes: 1024 * 1024 },
      )
      if (new TextEncoder().encode(result.content).byteLength > 1024 * 1024) {
        throw new Error('File exceeds the text read limit.')
      }
      return { target, content: result.content }
    }
    if (operation === 'filesystem.writeText') {
      if (
        typeof input.content !== 'string' ||
        Buffer.byteLength(input.content, 'utf8') > 1024 * 1024
      ) {
        throw new Error('Text writes require a string no larger than 1 MiB.')
      }
      await mutate('filesystem.writeFileTextInMount', {
        ...mountInput,
        content: input.content,
        overwrite: boolean(input.overwrite, 'overwrite'),
      })
    } else if (operation === 'filesystem.mkdir') {
      await mutate('filesystem.createDirectoryInMount', mountInput)
    } else if (operation === 'filesystem.rename') {
      if (input.newPath === undefined) {
        throw new Error('Rename requires an explicit newPath.')
      }
      const targetUri = uriFor(target, input.newPath, true)
      await mutate('filesystem.renameEntryInMount', {
        mountId: target.mountId,
        sourceUri: uri,
        targetUri,
      })
      return { target, uri: targetUri }
    } else {
      await mutate('filesystem.deleteEntryInMount', {
        ...mountInput,
        recursive: boolean(input.recursive, 'recursive'),
      })
    }
    return { target, uri }
  }
  return { request, retire: (ownerId: string) => watches.retire(ownerId) }
}
