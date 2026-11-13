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

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.error || result.status !== 0) {
    throw new Error(
      `Failed to list repository files: ${result.error?.message ?? result.stderr?.trim() ?? 'git failed'}`,
    )
  }

  return result.stdout
}

// The checks run from the repository root whatever directory they are started in, so path rules
// (`scripts/`, generated paths, exemption keys) always see root-relative paths.
export function resolveRepositoryRoot(cwd = process.cwd()) {
  return runGit(cwd, ['rev-parse', '--show-toplevel']).trim()
}

// Tracked files plus new files that are not ignored: the same set in CI (tracked only) and on a
// developer machine (with work in progress), whatever is staged. Paths are relative to the root.
export function listRepositoryFiles(cwd = process.cwd()) {
  const root = resolveRepositoryRoot(cwd)
  return runGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(entry => entry.length > 0)
    .map(normalizeRepositoryPath)
    .filter(entry => !isExcludedRepositoryPath(entry))
}
