import path, { type PlatformPath } from 'node:path'

export type SpawnPathSemantics = Pick<PlatformPath, 'normalize' | 'parse' | 'sep'>

/** Lexical directory identity, preserving roots and directory-component case. */
export function spawnDirectoryIdentity(value: string, paths: SpawnPathSemantics = path): string {
  let normalized = paths.normalize(value)
  if (paths.sep !== '\\') {
    return normalized
  }
  normalized = normalized
    .replace(/^[a-zA-Z]:/, drive => drive.toLowerCase())
    .replace(/^\\\\[^\\]+/, host => host.toLowerCase())
  const root = paths.parse(normalized).root
  const directory = normalized.replace(/\\+$/, '')
  return directory.length < root.length ? root : directory
}
