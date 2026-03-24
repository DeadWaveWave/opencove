import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractLastAssistantMessageFromSessionData,
  readLastAssistantMessageFromOpenCodeSession,
  readLastAssistantMessageFromSessionFile,
} from '../../../src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage'
import { afterEach, describe, expect, it } from 'vitest'

interface SqliteWriteStatementLike {
  run: (...params: unknown[]) => unknown
}

interface SqliteWriteDbLike {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteWriteStatementLike
  close: () => void
}

async function openWritableSqliteDb(dbPath: string): Promise<SqliteWriteDbLike> {
  try {
    const module = await import('better-sqlite3')
    const BetterSqlite3 = module.default as unknown as new (
      filePath: string,
      options?: Record<string, unknown>,
    ) => SqliteWriteDbLike
    return new BetterSqlite3(dbPath)
  } catch {
    // Avoid `import('node:sqlite')` in tests because Vite's client transformer can reject it.
    const require = createRequire(import.meta.url)
    const sqlite = require('node:sqlite') as {
      DatabaseSync: new (filePath: string, options?: Record<string, unknown>) => unknown
    }
    return new sqlite.DatabaseSync(dbPath) as SqliteWriteDbLike
  }
}

describe('readLastAssistantMessageFromSessionFile', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(directory => {
        return fs.rm(directory, { recursive: true, force: true })
      }),
    )
  })

  it('extracts a trailing codex final answer without a newline', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-message-'))
    tempDirs.push(tempDir)
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: [],
        },
      })}\n${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [
            {
              type: 'output_text',
              text: 'All set.',
            },
          ],
        },
      })}`,
      'utf8',
    )

    await expect(readLastAssistantMessageFromSessionFile('codex', filePath)).resolves.toBe(
      'All set.',
    )
  })

  it('extracts codex task_complete last_agent_message payloads', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-message-'))
    tempDirs.push(tempDir)
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'turn_1',
        },
      })}\n${JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          turn_id: 'turn_1',
          last_agent_message: 'Done.',
        },
      })}`,
      'utf8',
    )

    await expect(readLastAssistantMessageFromSessionFile('codex', filePath)).resolves.toBe('Done.')
  })

  it('ignores an incomplete trailing record and keeps the last complete codex message', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-message-'))
    tempDirs.push(tempDir)
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          phase: 'final_answer',
          message: 'Stable answer',
        },
      })}\n{"type":"response_item","payload":{"type":"message"`,
      'utf8',
    )

    await expect(readLastAssistantMessageFromSessionFile('codex', filePath)).resolves.toBe(
      'Stable answer',
    )
  })

  it('extracts the last claude assistant text block', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-message-'))
    tempDirs.push(tempDir)
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          stop_reason: null,
          content: [
            {
              type: 'thinking',
              thinking: 'Working...',
            },
          ],
        },
      })}\n${JSON.stringify({
        type: 'assistant',
        message: {
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: 'Summarized note content',
            },
          ],
        },
      })}`,
      'utf8',
    )

    await expect(readLastAssistantMessageFromSessionFile('claude-code', filePath)).resolves.toBe(
      'Summarized note content',
    )
  })

  it('extracts the last gemini reply from a structured session file', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-message-'))
    tempDirs.push(tempDir)
    const filePath = join(tempDir, 'gemini-session.json')

    await fs.writeFile(
      filePath,
      JSON.stringify({
        messages: [
          { type: 'user', content: [{ text: 'Ship it' }] },
          { type: 'gemini', content: [{ text: 'Ready to merge.' }] },
        ],
      }),
      'utf8',
    )

    await expect(readLastAssistantMessageFromSessionFile('gemini', filePath)).resolves.toBe(
      'Ready to merge.',
    )
  })

  it('extracts the last opencode assistant reply from exported session data', () => {
    expect(
      extractLastAssistantMessageFromSessionData('opencode', {
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'status?' }] },
          { role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] },
        ],
      }),
    ).toBe('Done.')
  })

  it('extracts the last opencode assistant reply from the session database', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-opencode-db-'))
    tempDirs.push(tempDir)

    const previousXdgDataHome = process.env.XDG_DATA_HOME
    const xdgDataHome = join(tempDir, 'xdg-data')
    process.env.XDG_DATA_HOME = xdgDataHome

    const sessionId = 'ses_test_1'
    const cwd = join(tempDir, 'workspace')
    const dbPath = join(xdgDataHome, 'opencode', 'opencode.db')

    let db: SqliteWriteDbLike | null = null

    try {
      await fs.mkdir(join(xdgDataHome, 'opencode'), { recursive: true })

      db = await openWritableSqliteDb(dbPath)
      db.exec(`
        CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL);
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          data TEXT NOT NULL
        );
        CREATE TABLE part (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          data TEXT NOT NULL
        );
      `)

      db.prepare('INSERT INTO session (id, directory) VALUES (?, ?)').run(sessionId, cwd)
      db.prepare(
        'INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)',
      ).run('msg_assistant', sessionId, 1, JSON.stringify({ role: 'assistant' }))
      db.prepare(
        'INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)',
      ).run(
        'prt_text',
        'msg_assistant',
        sessionId,
        2,
        JSON.stringify({ type: 'text', text: 'Final answer' }),
      )

      await expect(readLastAssistantMessageFromOpenCodeSession(sessionId, cwd)).resolves.toBe(
        'Final answer',
      )
    } finally {
      process.env.XDG_DATA_HOME = previousXdgDataHome

      try {
        db?.close()
      } catch {
        // ignore
      }
    }
  })
})
