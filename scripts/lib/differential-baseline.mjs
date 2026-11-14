import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

/** Explicit opt-in only; a shallow checkout is a supported ordinary-CI environment. */
export function resolveDifferentialBaseline(ref, run = spawnSync) {
  if (!ref?.trim()) {
    return {
      enabled: false,
      reason:
        'Claude differential verification is skipped: set OPENCOVE_DIFFERENTIAL_BASELINE to an available Git ref.',
    }
  }
  const result = run(
    'git',
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
    { cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8' },
  )
  if (result.status !== 0) {
    return {
      enabled: false,
      reason: `Claude differential verification is skipped: Git ref ${JSON.stringify(ref)} is unavailable in this checkout. Fetch that ref and rerun.`,
    }
  }
  return { enabled: true, commit: result.stdout.trim() }
}
