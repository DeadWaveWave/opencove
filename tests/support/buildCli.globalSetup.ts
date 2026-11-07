import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Always rebuild: a present artifact may still be stale relative to the tested sources. */
export default function buildCliForTests(): void {
  execFileSync(process.execPath, ['scripts/build-cli.mjs'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    stdio: 'inherit',
  })
}
