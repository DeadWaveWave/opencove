import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

function isDescendantPath(parentPath: string, candidatePath: string): boolean {
  const resolvedParent = resolve(parentPath)
  const resolvedCandidate = resolve(candidatePath)
  const rel = relative(resolvedParent, resolvedCandidate)
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${sep}`)
}

async function assertMoveTargetAllowed(sourcePath: string, targetPath: string): Promise<void> {
  if (resolve(sourcePath) === resolve(targetPath)) {
    return
  }

  if (await pathExists(targetPath)) {
    throw new Error('The destination already exists.')
  }

  const sourceStats = await stat(sourcePath)
  if (sourceStats.isDirectory() && isDescendantPath(sourcePath, targetPath)) {
    throw new Error('A folder cannot be moved or copied into itself.')
  }
}

async function movePath(sourcePath: string, targetPath: string): Promise<void> {
  await assertMoveTargetAllowed(sourcePath, targetPath)
  if (resolve(sourcePath) === resolve(targetPath)) {
    return
  }

  try {
    await rename(sourcePath, targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EXDEV') {
      throw error
    }

    await cp(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
    await rm(sourcePath, { recursive: true, force: false })
  }
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
    copyEntry: async ({ sourceUri, targetUri }) => {
      const sourcePath = fileUriToPath(sourceUri)
      const targetPath = fileUriToPath(targetUri)
      await assertMoveTargetAllowed(sourcePath, targetPath)
      if (resolve(sourcePath) === resolve(targetPath)) {
        throw new Error('The destination already exists.')
      }

      await cp(sourcePath, targetPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
      })
    },
    createDirectory: async ({ uri }) => {
      const path = fileUriToPath(uri)
      await mkdir(path, { recursive: false })
    },
    deleteEntry: async ({ uri }) => {
      const path = fileUriToPath(uri)
      await rm(path, { recursive: true, force: false })
    },
    moveEntry: async ({ sourceUri, targetUri }) => {
      await movePath(fileUriToPath(sourceUri), fileUriToPath(targetUri))
    },
    readFileBytes: async ({ uri }) => {
      const path = fileUriToPath(uri)
      const bytes = await readFile(path)
      return { bytes: new Uint8Array(bytes) }
    },
    readFileText: async ({ uri }) => {
      const path = fileUriToPath(uri)
      const content = await readFile(path, 'utf8')
      return { content }
    },
    renameEntry: async ({ sourceUri, targetUri }) => {
      await movePath(fileUriToPath(sourceUri), fileUriToPath(targetUri))
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
