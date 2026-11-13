import { spawnSync } from 'node:child_process'

// Directories that never hold authored sources. Matched as path prefixes, never as substrings, so
// a hand-written `src/.../layout/` or `src/.../out/` directory is still listed.
const EXCLUDED_PREFIXES = ['node_modules/', 'dist/', 'out/']

export function normalizeRepositoryPath(filePath) {
  return filePath.replaceAll('\\', '/')
}

export function isExcludedRepositoryPath(filePath) {
  const normalized = normalizeRepositoryPath(filePath)
  return EXCLUDED_PREFIXES.some(prefix => normalized.startsWith(prefix))
}

// Tracked files plus new files that are not ignored: the same set in CI (tracked only) and on a
// developer machine (with work in progress), whatever is staged.
export function listRepositoryFiles(cwd = process.cwd()) {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )

  if (result.error || result.status !== 0) {
    throw new Error(
      `Failed to list repository files: ${result.error?.message ?? result.stderr?.trim() ?? 'git failed'}`,
    )
  }

  return result.stdout
    .split('\0')
    .filter(entry => entry.length > 0)
    .map(normalizeRepositoryPath)
    .filter(entry => !isExcludedRepositoryPath(entry))
}
