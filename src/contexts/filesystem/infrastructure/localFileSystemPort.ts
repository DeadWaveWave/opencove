import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toFileUri } from '../domain/fileUri'
import type { FileSystemEntryKind, FileSystemPort } from '../application/ports'

function assertFileUri(uri: string): URL {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw new Error('Invalid uri')
  }

  if (parsed.protocol !== 'file:') {
    throw new Error(`Unsupported uri scheme: ${parsed.protocol}`)
  }

  return parsed
}

function fileUriToPath(uri: string): string {
  const parsed = assertFileUri(uri)
  return fileURLToPath(parsed)
}

function toEntryKind(dirent: {
  isFile: () => boolean
  isDirectory: () => boolean
}): FileSystemEntryKind {
  if (dirent.isDirectory()) {
    return 'directory'
  }

  if (dirent.isFile()) {
    return 'file'
  }

  return 'unknown'
}

export function createLocalFileSystemPort(): FileSystemPort {
  return {
    readFileText: async ({ uri }) => {
      const path = fileUriToPath(uri)
      const content = await readFile(path, 'utf8')
      return { content }
    },
    writeFileText: async ({ uri, content }) => {
      const path = fileUriToPath(uri)
      await writeFile(path, content, 'utf8')
    },
    stat: async ({ uri }) => {
      const path = fileUriToPath(uri)
      const stats = await stat(path)
      const kind: FileSystemEntryKind = stats.isDirectory()
        ? 'directory'
        : stats.isFile()
          ? 'file'
          : 'unknown'

      return {
        uri,
        kind,
        sizeBytes: Number.isFinite(stats.size) ? stats.size : null,
        mtimeMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null,
      }
    },
    readDirectory: async ({ uri }) => {
      const path = fileUriToPath(uri)
      const dirents = await readdir(path, { withFileTypes: true })

      return {
        entries: dirents.map(dirent => {
          const nextPath = join(path, dirent.name)
          return {
            name: dirent.name,
            uri: toFileUri(nextPath),
            kind: toEntryKind(dirent),
          }
        }),
      }
    },
  }
}
