export function normalizeComparablePath(pathValue: string): string {
  const normalized = pathValue
    .trim()
    .replace(/[/\\]+$/, '')
    .replaceAll('\\', '/')
  const platform = window.opencoveApi?.meta?.platform
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function toShortSha(value: string): string {
  return value.trim().slice(0, 7)
}
