import Database from 'better-sqlite3'
import { createRequire } from 'node:module'
import type { IPty, IPtyForkOptions } from 'node-pty'

export async function verifyNativeRuntime(): Promise<void> {
  const sqlite = new Database(':memory:')
  sqlite.prepare('SELECT 1').get()
  sqlite.close()
  const require = createRequire(__filename)
  const pty = require('node-pty') as {
    spawn: (file: string, args: string[], options: IPtyForkOptions) => IPty
  }
  const windows = process.platform === 'win32'
  const child = pty.spawn(
    windows ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh',
    windows ? ['/d', '/s', '/c', 'exit 0'] : ['-c', 'exit 0'],
    { cols: 80, rows: 24, env: process.env },
  )
  await new Promise<void>((resolve, reject) => {
    const data = child.onData(() => undefined)
    const timer = setTimeout(() => {
      child.kill()
      data.dispose()
      exit.dispose()
      reject(new Error('Native PTY verification timed out.'))
    }, 10_000)
    const exit = child.onExit(event => {
      clearTimeout(timer)
      data.dispose()
      exit.dispose()
      if (event.exitCode === 0) {
        resolve()
      } else {
        reject(new Error(`Native PTY verification failed (${event.exitCode}).`))
      }
    })
  })
}
