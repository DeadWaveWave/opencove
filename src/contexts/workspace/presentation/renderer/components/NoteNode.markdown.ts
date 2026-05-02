import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import type { MountAwareFilesystemApi } from '../utils/mountAwareFilesystemApi'

export const STICKY_NOTES_DIRECTORY_NAME = 'sticky'

const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

export function normalizeMarkdownFileName(input: string): string | null {
  const stem = input
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replaceAll(/./g, character => (character.charCodeAt(0) < 32 ? '-' : character))
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')

  if (!stem) {
    return null
  }

  const withExtension = /\.md$/i.test(stem) ? stem : `${stem}.md`
  const baseName = withExtension.replace(/\.md$/i, '').toLowerCase()
  if (WINDOWS_RESERVED_NAMES.has(baseName)) {
    return `note-${withExtension}`
  }

  return withExtension
}

export function joinFileSystemPath(directoryPath: string, fileName: string): string {
  const separator = directoryPath.includes('\\') && !directoryPath.includes('/') ? '\\' : '/'
  const trimmedDirectory = directoryPath.replace(/[\\/]+$/g, '')

  if (!trimmedDirectory) {
    return fileName
  }

  return `${trimmedDirectory}${separator}${fileName}`
}

export function resolveStickyNotesDirectoryPath(workspacePath: string): string {
  return joinFileSystemPath(workspacePath, STICKY_NOTES_DIRECTORY_NAME)
}

async function ensureDirectoryExists({
  filesystemApi,
  directoryPath,
}: {
  filesystemApi: Pick<MountAwareFilesystemApi, 'createDirectory' | 'stat'>
  directoryPath: string
}): Promise<void> {
  const directoryUri = toFileUri(directoryPath)

  const existing = await filesystemApi.stat({ uri: directoryUri }).catch(() => null)
  if (existing) {
    if (existing.kind === 'directory') {
      return
    }

    throw new Error(`${directoryPath} exists but is not a directory.`)
  }

  try {
    await filesystemApi.createDirectory({ uri: directoryUri })
  } catch (createError) {
    const stat = await filesystemApi.stat({ uri: directoryUri }).catch(() => null)
    if (stat?.kind === 'directory') {
      return
    }

    throw createError
  }
}

export async function saveNoteAsMarkdownFile({
  filesystemApi,
  directoryPath,
  fileName,
  text,
}: {
  filesystemApi: Pick<MountAwareFilesystemApi, 'createDirectory' | 'stat' | 'writeFileText'>
  directoryPath: string
  fileName: string
  text: string
}): Promise<string> {
  await ensureDirectoryExists({ filesystemApi, directoryPath })
  const targetPath = joinFileSystemPath(directoryPath, fileName)
  const targetUri = toFileUri(targetPath)
  await filesystemApi.writeFileText({ uri: targetUri, content: text })
  return targetPath
}
