import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import type { MountAwareFilesystemApi } from '../utils/mountAwareFilesystemApi'

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

export async function saveNoteAsMarkdownFile({
  filesystemApi,
  directoryPath,
  fileName,
  text,
}: {
  filesystemApi: Pick<MountAwareFilesystemApi, 'writeFileText'>
  directoryPath: string
  fileName: string
  text: string
}): Promise<string> {
  const targetPath = joinFileSystemPath(directoryPath, fileName)
  const targetUri = toFileUri(targetPath)
  await filesystemApi.writeFileText({ uri: targetUri, content: text })
  return targetPath
}
