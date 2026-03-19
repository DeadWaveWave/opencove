import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { resolveAgentCliInvocation } from './AgentCliInvocation'

const CLI_TIMEOUT_MS = 1_500
const CLI_MAX_BUFFER_BYTES = 8 * 1024 * 1024

export function wait(durationMs: number): Promise<void> {
  return new Promise(resolveWait => {
    setTimeout(resolveWait, durationMs)
  })
}

export async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    return entries.filter(entry => entry.isFile()).map(entry => join(directory, entry.name))
  } catch {
    return []
  }
}

export async function listDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => join(directory, entry.name))
  } catch {
    return []
  }
}

export function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value !== 'string') {
    return null
  }

  const timestampMs = Date.parse(value)
  return Number.isFinite(timestampMs) ? timestampMs : null
}

export function normalizeTimestampMsWithSecondsFallback(value: unknown): number | null {
  const timestampMs = parseTimestampMs(value)
  if (timestampMs === null) {
    return null
  }

  // Some SQLite schemas store unix timestamps in seconds.
  if (timestampMs > 0 && timestampMs < 10_000_000_000) {
    return timestampMs * 1000
  }

  return timestampMs
}

export async function executeCliCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<string | null> {
  try {
    const invocation = await resolveAgentCliInvocation({ command, args })

    return await new Promise((resolveOutput, reject) => {
      execFile(
        invocation.command,
        invocation.args,
        {
          cwd,
          env: process.env,
          encoding: 'utf8',
          windowsHide: true,
          timeout: CLI_TIMEOUT_MS,
          maxBuffer: CLI_MAX_BUFFER_BYTES,
        },
        (error, stdout) => {
          if (error) {
            reject(error)
            return
          }

          resolveOutput(stdout)
        },
      )
    })
  } catch {
    return null
  }
}
