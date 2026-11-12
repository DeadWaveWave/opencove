import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Build into a temporary directory, then refresh out/cli only when the artifact is missing or
 * differs. A clean checkout (CI runs unit tests before the app build) gets a fresh CLI, and an
 * up-to-date artifact that a running app or E2E uses is never rewritten.
 */
export default function buildCliForTests(): void {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const output = mkdtempSync(join(tmpdir(), 'opencove-cli-build-'))
  try {
    execFileSync(process.execPath, ['scripts/build-cli.mjs', '--out-dir', output], {
      cwd: root,
      stdio: 'inherit',
    })
    const built = join(output, 'opencove.mjs')
    const target = join(root, 'out/cli/opencove.mjs')
    if (existsSync(target) && readFileSync(target).equals(readFileSync(built))) {
      return
    }
    mkdirSync(dirname(target), { recursive: true })
    // Replace atomically so a concurrent reader never sees a partial file.
    const staged = `${target}.${process.pid}.tmp`
    copyFileSync(built, staged)
    chmodSync(staged, 0o755)
    renameSync(staged, target)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
}
