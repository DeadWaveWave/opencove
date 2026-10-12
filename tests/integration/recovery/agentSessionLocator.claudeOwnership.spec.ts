import fs from 'node:fs/promises'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { locateAgentResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator'
import { resolveClaudeProjectDirectoryCandidateGroups } from '../../../src/contexts/agent/infrastructure/ClaudeProjectPaths'

const sessionA = '11111111-1111-4111-8111-111111111111'
const sessionB = '22222222-2222-4222-8222-222222222222'
const sessionC = '33333333-3333-4333-8333-333333333333'

describe('Claude session discovery ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it.each(['single', 'concurrent', 'parent', 'ambiguous', 'mismatched-content'] as const)(
    'does not bind an unknown node to %s transcript candidates',
    async scenario => {
      const home = await fs.mkdtemp(join(os.tmpdir(), 'opencove-claude-ownership-'))
      vi.stubEnv('HOME', home)
      vi.stubEnv('USERPROFILE', home)
      vi.stubEnv('HOMEDRIVE', '')
      vi.stubEnv('HOMEPATH', home)
      vi.stubEnv('CLAUDE_CONFIG_DIR', join(home, '.claude'))
      vi.spyOn(os, 'homedir').mockReturnValue(home)
      vi.spyOn(os, 'userInfo').mockReturnValue({ ...os.userInfo(), homedir: home })
      const startedAtMs = Date.now()
      const cwd = join(home, 'workspace', 'docs')

      try {
        const groups = resolveClaudeProjectDirectoryCandidateGroups(cwd)
        expect(os.homedir()).toBe(home)
        for (const directory of groups.flat()) {
          expect(directory.startsWith(join(home, '.claude', 'projects'))).toBe(true)
        }
        const directory = groups[scenario === 'parent' ? 1 : 0]![0]!
        await fs.mkdir(directory, { recursive: true })
        const candidates =
          scenario === 'concurrent' || scenario === 'ambiguous'
            ? [sessionA, sessionB, sessionC]
            : [sessionC]
        await Promise.all(
          candidates.map(async (sessionId, index) => {
            const path = join(directory, `${sessionId}.jsonl`)
            await fs.writeFile(
              path,
              `${JSON.stringify({
                type: 'user',
                sessionId: scenario === 'mismatched-content' ? sessionA : sessionId,
                cwd: scenario === 'mismatched-content' ? join(home, 'unrelated') : resolve(cwd),
                timestamp: new Date(startedAtMs).toISOString(),
                message: { role: 'user', content: 'Synthetic ownership fixture' },
              })}\n`,
            )
            const mtime = new Date(startedAtMs + (scenario === 'ambiguous' ? 0 : index * 100))
            await fs.utimes(path, mtime, mtime)
          }),
        )

        const launch = { provider: 'claude-code' as const, cwd, startedAtMs, timeoutMs: 0 }
        expect(
          await Promise.all([
            locateAgentResumeSessionId(launch),
            locateAgentResumeSessionId(launch),
          ]),
        ).toEqual([null, null])
      } finally {
        await fs.rm(home, { recursive: true, force: true })
      }
    },
  )
})
