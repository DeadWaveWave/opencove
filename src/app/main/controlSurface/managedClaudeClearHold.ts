import { access, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

/** File barrier for deterministic shutdown acceptance; disabled outside test mode. */
export async function holdClaudeClearProof(signal: AbortSignal): Promise<void> {
  const path =
    process.env.NODE_ENV === 'test' ? process.env.OPENCOVE_TEST_CLAUDE_CLEAR_PROOF_HOLD : undefined
  if (!path) {
    return
  }
  try {
    await access(path)
  } catch {
    return
  }
  await writeFile(`${path}.admitted`, '')
  const deadline = performance.now() + 4500
  while (!signal.aborted && performance.now() < deadline) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      await access(path)
    } catch {
      return
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(10, undefined, { signal })
  }
}
export function markClaudeClearDrain(): void {
  const path =
    process.env.NODE_ENV === 'test' ? process.env.OPENCOVE_TEST_CLAUDE_CLEAR_PROOF_HOLD : undefined
  if (path) {
    void writeFile(`${path}.draining`, '').catch(() => {})
  }
}
