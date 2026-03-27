import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { sleep } from './sleep.mjs'

export async function runOpenCodeIdleWithMessageScenario(cwd) {
  const hostname = process.env.OPENCOVE_OPENCODE_SERVER_HOSTNAME?.trim() ?? ''
  const port = Number(process.env.OPENCOVE_OPENCODE_SERVER_PORT ?? '')

  if (hostname.length === 0 || !Number.isFinite(port) || port <= 0) {
    await sleep(20_000)
    return
  }

  const sessionId = `opencove-test-opencode-${Date.now()}`
  const startedAtMs = Date.now()

  const opencodeDir = join(os.homedir(), '.local', 'share', 'opencode')
  const dbPath = join(opencodeDir, 'opencode.db')
  await fs.mkdir(opencodeDir, { recursive: true })

  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const Database = require('better-sqlite3')
  const db = new Database(dbPath)

  try {
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY,
        directory TEXT,
        time_created INTEGER
      );
      CREATE TABLE IF NOT EXISTS message (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        time_created INTEGER,
        data TEXT
      );
      CREATE TABLE IF NOT EXISTS part (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        time_created INTEGER,
        data TEXT
      );
    `)

    db.prepare('INSERT OR REPLACE INTO session (id, directory, time_created) VALUES (?, ?, ?)').run(
      sessionId,
      cwd,
      startedAtMs,
    )

    const messageId = `msg-${startedAtMs}`
    db.prepare(
      'INSERT OR REPLACE INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)',
    ).run(messageId, sessionId, startedAtMs + 100, JSON.stringify({ role: 'assistant' }))

    db.prepare(
      'INSERT OR REPLACE INTO part (id, message_id, time_created, data) VALUES (?, ?, ?, ?)',
    ).run(
      `part-${startedAtMs}`,
      messageId,
      startedAtMs + 120,
      JSON.stringify({ type: 'text', text: 'OK' }),
    )
  } finally {
    db.close()
  }

  const { createServer } = await import('node:http')
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${hostname}:${port}`)

    if (url.pathname === '/session') {
      const requestedDir = url.searchParams.get('directory')
      const body =
        requestedDir && requestedDir !== cwd
          ? []
          : [
              {
                id: sessionId,
                directory: cwd,
                created: new Date(startedAtMs).toISOString(),
              },
            ]

      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
      return
    }

    if (url.pathname === '/session/status') {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ [sessionId]: 'idle' }))
      return
    }

    res.statusCode = 404
    res.end('not found')
  })

  server.listen(port, hostname)
  server.unref?.()

  await sleep(120_000)
}
