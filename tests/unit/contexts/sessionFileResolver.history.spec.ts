// @vitest-environment node
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'

it('locates a resumed Codex rollout by its verified identity regardless of date or mtime', async () => {
  const home = await fs.mkdtemp(join(tmpdir(), 'opencove-rollout-history-'))
  vi.stubEnv('CODEX_HOME', home)
  const cwd = join(home, 'workspace')
  const file = join(home, 'sessions', '2020', '01', '01', 'rollout-saved.jsonl')
  try {
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'saved', cwd, timestamp: '2020-01-01T00:00:00Z' },
      }) + '\n',
    )
    await fs.utimes(file, new Date(0), new Date(0))
    const input = {
      provider: 'codex' as const,
      cwd,
      sessionId: 'saved',
      startedAtMs: Date.now(),
      timeoutMs: 0,
    }
    expect(await resolveSessionFilePath(input)).toBe(file)
    expect(await resolveSessionFilePath({ ...input, cwd: join(home, 'other') })).toBeNull()
  } finally {
    vi.unstubAllEnvs()
    await fs.rm(home, { recursive: true, force: true })
  }
})
