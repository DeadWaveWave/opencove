import { fromFileUri } from '@contexts/filesystem/domain/fileUri'
import type { FileSystemEntry } from '@shared/contracts/dto'

export interface SpaceExplorerClipboardItem {
  mode: 'copy' | 'cut'
  entry: FileSystemEntry
}

export interface SpaceExplorerContextMenuState {
  kind: 'root' | 'entry'
  x: number
  y: number
  entry: FileSystemEntry | null
}

export interface SpaceExplorerDeleteConfirmationState {
  entry: FileSystemEntry
}

export interface SpaceExplorerMoveHistoryEntry {
  entryKind: FileSystemEntry['kind']
  sourceUri: string
  targetUri: string
}

export type SpaceExplorerMovePlan =
  | { kind: 'noop' }
  | { kind: 'invalid-descendant' }
  | { kind: 'invalid-target' }
  | { kind: 'move'; targetUri: string }

export function resolveEntryMovePlan(options: {
  entry: FileSystemEntry
  targetDirectoryUri: string
}): SpaceExplorerMovePlan {
  if (options.entry.kind === 'directory') {
    if (isSameFileUri(options.entry.uri, options.targetDirectoryUri)) {
      return { kind: 'noop' }
    }

    if (isWithinDirectoryUri(options.entry.uri, options.targetDirectoryUri)) {
      return { kind: 'invalid-descendant' }
    }
  }

  const targetUri = buildChildUri(options.targetDirectoryUri, options.entry.name)
  if (!targetUri) {
    return { kind: 'invalid-target' }
  }

  if (isSameFileUri(targetUri, options.entry.uri)) {
    return { kind: 'noop' }
  }

  return {
    kind: 'move',
    targetUri,
  }
}

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized.length > 0 ? normalized : '/'
}

export function validateCreateName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return false
  }
  if (trimmed === '.' || trimmed === '..') {
    return false
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return false
  }
  return true
}

export function buildChildUri(baseUri: string, name: string): string | null {
  try {
    const ensuredBase = baseUri.endsWith('/') ? baseUri : `${baseUri}/`
    return new URL(encodeURIComponent(name.trim()), ensuredBase).toString()
  } catch {
    return null
  }
}

export function resolveParentDirectoryUri(uri: string, fallbackUri: string): string {
  try {
    return new URL('.', uri).toString().replace(/\/$/, '')
  } catch {
    return fallbackUri
  }
}

export function resolveEntryNameFromUri(uri: string, fallback = ''): string {
  try {
    const parsed = new URL(uri)
    const pathname = normalizePathname(parsed.pathname ?? '')
    const lastSegment = pathname.split('/').filter(Boolean).pop() ?? ''
    const decoded = decodeURIComponent(lastSegment)
    return decoded.length > 0 ? decoded : fallback
  } catch {
    return fallback
  }
}

export function resolveEntryAbsolutePath(uri: string): string | null {
  return fromFileUri(uri)
}

export function resolveEntryRelativePath(rootUri: string, uri: string): string | null {
  try {
    const root = new URL(rootUri)
    const entry = new URL(uri)

    if (root.protocol !== 'file:' || entry.protocol !== 'file:') {
      return null
    }

    if ((root.host ?? '') !== (entry.host ?? '')) {
      return null
    }

    const rootSegments = normalizePathname(root.pathname ?? '')
      .split('/')
      .filter(Boolean)
      .map(segment => decodeURIComponent(segment))
    const entrySegments = normalizePathname(entry.pathname ?? '')
      .split('/')
      .filter(Boolean)
      .map(segment => decodeURIComponent(segment))

    if (
      rootSegments.length > entrySegments.length ||
      rootSegments.some((segment, index) => segment !== entrySegments[index])
    ) {
      return null
    }

    const relativeSegments = entrySegments.slice(rootSegments.length)
    return relativeSegments.length > 0 ? relativeSegments.join('/') : '.'
  } catch {
    return null
  }
}

export function isSameFileUri(leftUri: string, rightUri: string): boolean {
  try {
    const left = new URL(leftUri)
    const right = new URL(rightUri)

    if (left.protocol !== 'file:' || right.protocol !== 'file:') {
      return false
    }

    return (
      normalizePathname(left.pathname ?? '') === normalizePathname(right.pathname ?? '') &&
      (left.host ?? '') === (right.host ?? '')
    )
  } catch {
    return false
  }
}

export function isWithinDirectoryUri(directoryUri: string, candidateUri: string): boolean {
  try {
    const directory = new URL(directoryUri)
    const candidate = new URL(candidateUri)

    if (directory.protocol !== 'file:' || candidate.protocol !== 'file:') {
      return false
    }

    if ((directory.host ?? '') !== (candidate.host ?? '')) {
      return false
    }

    const directoryPath = normalizePathname(directory.pathname ?? '')
    const candidatePath = normalizePathname(candidate.pathname ?? '')

    return candidatePath === directoryPath || candidatePath.startsWith(`${directoryPath}/`)
  } catch {
    return false
  }
}

export function splitFileNameForCopy(name: string): { stem: string; extension: string } {
  const lastDot = name.lastIndexOf('.')
  if (lastDot <= 0) {
    return { stem: name, extension: '' }
  }

  return {
    stem: name.slice(0, lastDot),
    extension: name.slice(lastDot),
  }
}

export function resolveCopyName(
  name: string,
  attempt: number,
  entryKind: FileSystemEntry['kind'],
): string {
  if (entryKind !== 'file') {
    return attempt === 1 ? `${name} copy` : `${name} copy ${attempt}`
  }

  const { stem, extension } = splitFileNameForCopy(name)
  return attempt === 1 ? `${stem} copy${extension}` : `${stem} copy ${attempt}${extension}`
}

export function resolveAvailablePasteTarget(options: {
  clipboard: SpaceExplorerClipboardItem
  targetDirectoryUri: string
  siblingEntries: FileSystemEntry[]
}): string | null {
  const sourceName = options.clipboard.entry.name
  const existingNames = new Set(options.siblingEntries.map(entry => entry.name.toLocaleLowerCase()))

  if (options.clipboard.mode === 'cut') {
    return buildChildUri(options.targetDirectoryUri, sourceName)
  }

  if (!existingNames.has(sourceName.toLocaleLowerCase())) {
    return buildChildUri(options.targetDirectoryUri, sourceName)
  }

  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    const nextName = resolveCopyName(sourceName, attempt, options.clipboard.entry.kind)
    if (existingNames.has(nextName.toLocaleLowerCase())) {
      continue
    }

    return buildChildUri(options.targetDirectoryUri, nextName)
  }

  return null
}
