import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'

describe('resolveSessionFilePath', () => {
  it('returns null for claude-code when session file does not exist yet', async () => {
    const tempHome = await fs.mkdtemp(join(tmpdir(), 'cove-test-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = tempHome

    const cwd = join(tempHome, 'workspace')
    const sessionId = 'session-123'
    const startedAtMs = Date.now()

    try {
      const resolved = await resolveSessionFilePath({
        provider: 'claude-code',
        cwd,
        sessionId,
        startedAtMs,
        timeoutMs: 0,
      })

      expect(resolved).toBeNull()
    } finally {
      process.env.HOME = previousHome
    }
  })

  it('resolves claude-code session file once it exists', async () => {
    const tempHome = await fs.mkdtemp(join(tmpdir(), 'cove-test-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = tempHome

    const cwd = join(tempHome, 'workspace')
    const sessionId = 'session-abc'
    const startedAtMs = Date.now()

    const encodedPath = resolvePath(cwd).replace(/[\\/]/g, '-').replace(/:/g, '')
    const expectedPath = join(tempHome, '.claude', 'projects', encodedPath, `${sessionId}.jsonl`)

    try {
      await fs.mkdir(dirname(expectedPath), { recursive: true })
      await fs.writeFile(expectedPath, '{"type":"assistant","message":{"content":[]}}\n', 'utf8')

      const resolved = await resolveSessionFilePath({
        provider: 'claude-code',
        cwd,
        sessionId,
        startedAtMs,
        timeoutMs: 0,
      })

      expect(resolved).toBe(expectedPath)
    } finally {
      process.env.HOME = previousHome
    }
  })

  it('resolves codex session file from rollout logs', async () => {
    const tempHome = await fs.mkdtemp(join(tmpdir(), 'cove-test-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = tempHome

    const cwd = join(tempHome, 'workspace')
    const sessionId = 'session-rollout-123'
    const startedAtMs = Date.now()

    const date = new Date(startedAtMs)
    const year = String(date.getFullYear())
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    const sessionsDir = join(tempHome, '.codex', 'sessions', year, month, day)
    const expectedPath = join(sessionsDir, 'rollout-session-rollout-123.jsonl')

    try {
      await fs.mkdir(sessionsDir, { recursive: true })

      const firstLine = JSON.stringify({ payload: { id: sessionId, cwd } })
      await fs.writeFile(expectedPath, `${firstLine}\n${'x'.repeat(100_000)}\n`, 'utf8')

      const resolved = await resolveSessionFilePath({
        provider: 'codex',
        cwd,
        sessionId,
        startedAtMs,
        timeoutMs: 0,
      })

      expect(resolved).toBe(expectedPath)
    } finally {
      process.env.HOME = previousHome
    }
  })

  it('resolves gemini session files from the matching project workspace', async () => {
    const tempHome = await fs.mkdtemp(join(tmpdir(), 'cove-test-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = tempHome

    const cwd = join(tempHome, 'workspace')
    const sessionId = 'gemini-session-123'
    const startedAtMs = Date.now()
    const projectDir = join(tempHome, '.gemini', 'tmp', 'workspace')
    const expectedPath = join(projectDir, 'chats', 'session-2026-03-15T08-00-test.json')

    try {
      await fs.mkdir(join(projectDir, 'chats'), { recursive: true })
      await fs.writeFile(join(projectDir, '.project_root'), resolvePath(cwd), 'utf8')
      await fs.writeFile(
        expectedPath,
        JSON.stringify({
          sessionId,
          messages: [{ type: 'user', content: [{ text: 'hello' }] }],
        }),
        'utf8',
      )

      const resolved = await resolveSessionFilePath({
        provider: 'gemini',
        cwd,
        sessionId,
        startedAtMs,
        timeoutMs: 0,
      })

      expect(resolved).toBe(expectedPath)
    } finally {
      process.env.HOME = previousHome
    }
  })
})
