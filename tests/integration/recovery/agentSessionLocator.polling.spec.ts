import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { locateAgentResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator'

function toDateParts(timestampMs: number): { year: string; month: string; day: string } {
  const date = new Date(timestampMs)
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  }
}

function createRolloutFirstLine({
  sessionId,
  cwd,
  timestamp,
}: {
  sessionId: string
  cwd: string
  timestamp: string
}): string {
  return JSON.stringify({
    timestamp,
    type: 'session_meta',
    payload: {
      id: sessionId,
      cwd,
      timestamp,
    },
  })
}

describe('locateAgentResumeSessionId polling', () => {
  it('uses the effective CODEX_HOME session root', async () => {
    const tempHome = await fs.mkdtemp(join(tmpdir(), 'opencove-user-home-'))
    const codexHome = await fs.mkdtemp(join(tmpdir(), 'opencove-codex-home-'))
    const previousHome = process.env.HOME
    const previousCodexHome = process.env.CODEX_HOME
    process.env.HOME = tempHome
    process.env.CODEX_HOME = codexHome

    const startedAtMs = Date.now()
    const { year, month, day } = toDateParts(startedAtMs)
    const cwd = join(tempHome, 'workspace')
    const sessionsDir = join(codexHome, 'sessions', year, month, day)

    try {
      await fs.mkdir(sessionsDir, { recursive: true })
      await fs.writeFile(
        join(sessionsDir, 'rollout-effective-home.jsonl'),
        `${createRolloutFirstLine({
          sessionId: 'session-from-effective-codex-home',
          cwd,
          timestamp: new Date(startedAtMs).toISOString(),
        })}\n`,
        'utf8',
      )

      await expect(
        locateAgentResumeSessionId({
          provider: 'codex',
          cwd,
          startedAtMs,
          timeoutMs: 0,
        }),
      ).resolves.toBe('session-from-effective-codex-home')
    } finally {
      process.env.HOME = previousHome
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME
      } else {
        process.env.CODEX_HOME = previousCodexHome
      }
      await fs.rm(tempHome, { recursive: true, force: true })
      await fs.rm(codexHome, { recursive: true, force: true })
    }
  })

  it('detects a codex session that appears after launch (late session_meta)', async () => {
    const tempHome = await fs.mkdtemp(join(tmpdir(), 'cove-integration-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = tempHome

    const startedAtMs = Date.now()
    const { year, month, day } = toDateParts(startedAtMs)
    const cwd = join(tempHome, 'workspace')
    const sessionsDir = join(tempHome, '.codex', 'sessions', year, month, day)
    const rolloutPath = join(sessionsDir, 'rollout-late.jsonl')

    let timer: ReturnType<typeof setTimeout> | null = null

    try {
      await fs.mkdir(cwd, { recursive: true })

      const locatePromise = locateAgentResumeSessionId({
        provider: 'codex',
        cwd,
        startedAtMs,
        timeoutMs: 1500,
      })

      timer = setTimeout(() => {
        void (async () => {
          await fs.mkdir(sessionsDir, { recursive: true })
          await fs.writeFile(
            rolloutPath,
            `${createRolloutFirstLine({
              sessionId: 'session-late',
              cwd,
              timestamp: new Date(startedAtMs + 150).toISOString(),
            })}
`,
            'utf8',
          )
        })()
      }, 350)

      await expect(locatePromise).resolves.toBe('session-late')
    } finally {
      if (timer) {
        clearTimeout(timer)
      }

      process.env.HOME = previousHome
      await fs.rm(tempHome, { recursive: true, force: true })
    }
  })
})
