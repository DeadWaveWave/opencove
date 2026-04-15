export function normalizeSlashes(pathValue: string): string {
  return pathValue.replace(/\\/g, '/')
}

export function isAbsolutePath(pathValue: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(pathValue)
}

export function basename(pathValue: string): string {
  const normalized = pathValue.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

export function dirname(pathValue: string): string {
  const trimmed = normalizeSlashes(pathValue.trim())
  if (trimmed.length === 0) {
    return ''
  }

  const withoutTrailing = trimmed.replace(/\/+$/, '')
  if (withoutTrailing.length === 0) {
    return '/'
  }

  if (withoutTrailing === '/') {
    return '/'
  }

  if (/^[a-zA-Z]:\/?$/.test(withoutTrailing)) {
    return withoutTrailing.endsWith('/') ? withoutTrailing : `${withoutTrailing}/`
  }

  const lastSlashIndex = withoutTrailing.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return withoutTrailing
  }

  const parent = withoutTrailing.slice(0, lastSlashIndex)
  if (parent.length === 0) {
    return '/'
  }

  if (/^[a-zA-Z]:$/.test(parent)) {
    return `${parent}/`
  }

  return parent
}
