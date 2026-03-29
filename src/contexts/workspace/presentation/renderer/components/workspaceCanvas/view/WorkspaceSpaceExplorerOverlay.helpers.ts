import type { FileSystemEntry } from '@shared/contracts/dto'

export type ViewportTransform = [number, number, number]

export function selectViewportTransform(state: unknown): ViewportTransform {
  const record = state as { transform?: unknown }
  const transform = record.transform
  if (Array.isArray(transform) && transform.length >= 3) {
    const [x, y, zoom] = transform
    if (
      typeof x === 'number' &&
      Number.isFinite(x) &&
      typeof y === 'number' &&
      Number.isFinite(y) &&
      typeof zoom === 'number' &&
      Number.isFinite(zoom) &&
      zoom > 0
    ) {
      return [x, y, zoom]
    }
  }

  return [0, 0, 1]
}

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized.length > 0 ? normalized : '/'
}

export function isWithinRootUri(rootUri: string, uri: string): boolean {
  try {
    const root = new URL(rootUri)
    const target = new URL(uri)

    if (root.protocol !== 'file:' || target.protocol !== 'file:') {
      return false
    }

    if ((root.host ?? '') !== (target.host ?? '')) {
      return false
    }

    const rootPath = normalizePathname(root.pathname ?? '')
    const targetPath = normalizePathname(target.pathname ?? '')

    return targetPath === rootPath || targetPath.startsWith(`${rootPath}/`)
  } catch {
    return false
  }
}

export function sortEntries(entries: FileSystemEntry[]): FileSystemEntry[] {
  return [...entries].sort((left, right) => {
    const leftIsDir = left.kind === 'directory'
    const rightIsDir = right.kind === 'directory'

    if (leftIsDir !== rightIsDir) {
      return leftIsDir ? -1 : 1
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })
}
