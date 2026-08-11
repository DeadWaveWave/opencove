import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PtyHostProcess } from './processTypes'

export function attachPtyHostProcessLogging(
  child: PtyHostProcess,
  logFilePath: string | null,
): void {
  if (!logFilePath) {
    return
  }

  try {
    mkdirSync(dirname(logFilePath), { recursive: true })
  } catch {
    // ignore
  }

  const stream = createWriteStream(logFilePath, { flags: 'a' })
  stream.write(`[${new Date().toISOString()}] pty-host start pid=${child.pid ?? 'unknown'}\n`)

  const writeChunk = (label: 'stdout' | 'stderr', chunk: unknown): void => {
    try {
      stream.write(`[${label}] ${String(chunk)}`)
    } catch {
      // ignore
    }
  }

  child.stdout?.on('data', chunk => writeChunk('stdout', chunk))
  child.stderr?.on('data', chunk => writeChunk('stderr', chunk))
  child.on('exit', code => {
    stream.write(`[${new Date().toISOString()}] pty-host exit code=${code}\n`)
    stream.end()
  })
}
