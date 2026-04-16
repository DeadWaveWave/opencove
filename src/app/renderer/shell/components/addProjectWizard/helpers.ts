export type DraftMount = {
  id: string
  endpointId: string
  rootPath: string
  name: string | null
}

export function isAbsolutePath(pathValue: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/)/.test(pathValue)
}

export function basename(pathValue: string): string {
  const normalized = pathValue.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}
