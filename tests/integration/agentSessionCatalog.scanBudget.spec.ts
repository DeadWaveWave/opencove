import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listAgentSessions } from '../../src/contexts/agent/infrastructure/cli/AgentSessionCatalog'
import { clearSessionFileCache } from '../../src/contexts/agent/infrastructure/cli/AgentSessionCatalog.cache'
import { encodeClaudeProjectPath } from '../../src/contexts/agent/infrastructure/ClaudeProjectPaths'

const paths = vi.hoisted(() => ({ home: '' }))
vi.mock('../../src/platform/os/HomeDirectory', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/platform/os/HomeDirectory')>()),
  resolveHomeDirectoryCandidates: () => [paths.home],
  resolveCodexHomeDirectoryCandidates: () => [join(paths.home, '.codex')],
}))

describe('session catalog filesystem budget', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    clearSessionFileCache()
    await fs.rm(paths.home, { recursive: true, force: true })
  })

  it.each(['claude-code', 'codex'] as const)(
    'bounds open transcripts while listing a large %s directory',
    async provider => {
      paths.home = await fs.mkdtemp(join(tmpdir(), 'opencove-catalog-budget-'))
      const cwd = join(paths.home, 'project')
      const directory =
        provider === 'claude-code'
          ? join(paths.home, '.claude', 'projects', encodeClaudeProjectPath(cwd))
          : join(paths.home, '.codex', 'sessions', '2026', '11', '09')
      await fs.mkdir(directory, { recursive: true })
      await Promise.all(
        Array.from({ length: 40 }, async (_, index) => {
          const records =
            provider === 'claude-code'
              ? [
                  { type: 'user', content: `Task ${index}` },
                  { type: 'ai-title', aiTitle: `Title ${index}` },
                ]
              : [
                  { type: 'session_meta', payload: { id: `session-${index}`, cwd } },
                  { type: 'message', role: 'user', content: `Task ${index}` },
                ]
          await fs.writeFile(
            join(
              directory,
              provider === 'codex' ? `rollout-${index}.jsonl` : `session-${index}.jsonl`,
            ),
            records.map(record => JSON.stringify(record)).join('\n') + '\n',
          )
        }),
      )
      const open = fs.open.bind(fs)
      let active = 0
      let peak = 0
      vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
        const handle = await open(file, flags, mode)
        if (String(file).endsWith('.jsonl')) {
          active++
          peak = Math.max(peak, active)
          const close = handle.close.bind(handle)
          handle.close = async () => {
            try {
              return await close()
            } finally {
              active--
            }
          }
        }
        return handle
      })
      const result = await listAgentSessions({ provider, cwd, limit: 100 })
      expect(result.sessions).toHaveLength(40)
      expect(result.sessions.every(session => session.preview !== null)).toBe(true)
      expect(active).toBe(0)
      // The catalog shares the Worker with persistence: a directory must not open every file.
      expect(peak).toBeLessThanOrEqual(16)
    },
  )
})
