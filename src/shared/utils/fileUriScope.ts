interface FileUriParts {
  host: string
  segments: string[]
}

function readFileUriParts(value: unknown): FileUriParts | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'file:' || parsed.search || parsed.hash) {
      return null
    }
    const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (
      segments.some(
        segment =>
          /[/\\]/.test(segment) || [...segment].some(character => character.charCodeAt(0) < 32),
      )
    ) {
      return null
    }
    if (segments[0] && /^[a-z]:$/i.test(segments[0])) {
      segments[0] = segments[0].toUpperCase()
    }
    return { host: parsed.hostname.toLowerCase(), segments }
  } catch {
    return null
  }
}

function toUri({ host, segments }: FileUriParts): string {
  const pathname = segments
    .map((segment, index) =>
      index === 0 && /^[A-Z]:$/.test(segment) ? segment : encodeURIComponent(segment),
    )
    .join('/')
  const driveRoot = segments.length === 1 && /^[A-Z]:$/.test(segments[0])
  return `file://${host}/${pathname}${driveRoot ? '/' : ''}`
}

function isWithin(root: FileUriParts, entry: FileUriParts): boolean {
  return (
    root.host === entry.host &&
    root.segments.length <= entry.segments.length &&
    root.segments.every((segment, index) => segment === entry.segments[index])
  )
}

/** UI navigation scope only; filesystem and mount permissions remain owned by the backend. */
export function normalizeFileUri(uri: unknown): string | null {
  const parts = readFileUriParts(uri)
  return parts ? toUri(parts) : null
}

export function isFileUriWithinRoot(rootUri: string, uri: string): boolean {
  const root = readFileUriParts(rootUri)
  const entry = readFileUriParts(uri)
  return !!root && !!entry && isWithin(root, entry)
}

export function resolveFileUriParent(uri: string, rootUri: string): string | null {
  const root = readFileUriParts(rootUri)
  const entry = readFileUriParts(uri)
  if (!root || !entry || !isWithin(root, entry) || root.segments.length === entry.segments.length) {
    return null
  }
  return toUri({ ...entry, segments: entry.segments.slice(0, -1) })
}

export function resolveFileUriName(uri: string, fallback = ''): string {
  const entry = readFileUriParts(uri)
  return entry?.segments.at(-1) ?? (entry ? entry.host || fallback || '/' : fallback)
}

export interface FileUriBreadcrumb {
  uri: string
  name: string
}

/** Relative display paths may leave the directory but never cross hosts or drives. */
export function resolveFileUriRelativePath(rootUri: string, uri: string): string | null {
  const root = readFileUriParts(rootUri)
  const entry = readFileUriParts(uri)
  if (!root || !entry || root.host !== entry.host) {
    return null
  }
  if (root.host && root.segments[0] !== entry.segments[0]) {
    return null
  }
  const rootDrive = root.segments[0]?.match(/^[A-Z]:$/)?.[0]
  const entryDrive = entry.segments[0]?.match(/^[A-Z]:$/)?.[0]
  if (rootDrive !== entryDrive) {
    return null
  }
  let shared = 0
  while (shared < root.segments.length && root.segments[shared] === entry.segments[shared]) {
    shared += 1
  }
  return (
    [...root.segments.slice(shared).map(() => '..'), ...entry.segments.slice(shared)].join('/') ||
    '.'
  )
}

export function resolveFileUriBreadcrumbs(rootUri: string, uri: string): FileUriBreadcrumb[] {
  const root = readFileUriParts(rootUri)
  const entry = readFileUriParts(uri)
  if (!root || !entry || !isWithin(root, entry)) {
    return []
  }
  const breadcrumbs: FileUriBreadcrumb[] = []
  for (let depth = root.segments.length; depth <= entry.segments.length; depth += 1) {
    const segments = entry.segments.slice(0, depth)
    breadcrumbs.push({
      uri: toUri({ host: entry.host, segments }),
      name: segments.at(-1) ?? (entry.host || '/'),
    })
  }
  return breadcrumbs
}
