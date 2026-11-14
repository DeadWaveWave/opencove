import { open } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, relative } from 'node:path'
import type { TestInfo } from '@playwright/test'
import { readRecords, type Hook } from './recovery.claude-clear.helpers'

export function sanitizeClearDiagnostic(value: unknown, root: string): string {
  const replacements = [
    [root, '<test-root>'],
    [process.cwd(), '<repo>'],
    [homedir(), '<home>'],
    [tmpdir(), '<temp>'],
  ]
    .flatMap(([path, label]) =>
      [path, path.replaceAll('\\', '/'), JSON.stringify(path).slice(1, -1)].map(candidate => [
        candidate,
        label,
      ]),
    )
    .sort((a, b) => b[0].length - a[0].length)
  let text = JSON.stringify(value, null, 2)
  for (const [path, label] of replacements) {
    text = text.replaceAll(path, label)
  }
  return text
}

/** Failure-only, bounded IO. Do not walk the config tree or write scratch files. */
export async function attachClearReadinessFailure(
  testInfo: Pick<TestInfo, 'attach'>,
  input: {
    root: string
    config: string
    hookLog: string
    successor: string
    snapshot(): Promise<unknown>
  },
): Promise<void> {
  const hooks = await readRecords<Hook>(input.hookLog).catch(error => [{ error: String(error) }])
  const last = hooks
    .filter(
      (record): record is Hook => 'input' in record && record.input.session_id === input.successor,
    )
    .at(-1)
  const path = last?.input.transcript_path
  let transcript: string | { error: string } = {
    error: 'No successor transcript path was observed.',
  }
  if (
    path &&
    !relative(input.config, path).startsWith('..') &&
    !isAbsolute(relative(input.config, path))
  ) {
    try {
      const handle = await open(path, 'r')
      try {
        const data = Buffer.alloc(Math.min((await handle.stat()).size, 512 * 1024))
        const { bytesRead } = await handle.read(data, 0, data.length, 0)
        transcript = data.subarray(0, bytesRead).toString('utf8')
      } finally {
        await handle.close()
      }
    } catch (error) {
      transcript = { error: String(error) }
    }
  }
  const snapshot = await input.snapshot().catch(error => ({ error: String(error) }))
  await testInfo.attach('claude-clear-readiness', {
    body: sanitizeClearDiagnostic(
      { snapshot, hooks, successor: input.successor, transcript },
      input.root,
    ),
    contentType: 'application/json',
  })
}
