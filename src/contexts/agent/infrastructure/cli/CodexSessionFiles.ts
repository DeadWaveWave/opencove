import fs from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { resolveCodexHomeDirectoryCandidates } from '../../../../platform/os/HomeDirectory'

export interface CodexSessionFile {
  sessionId: string
  cwd: string
  payloadTimestampMs: number | null
  recordTimestampMs: number | null
  filePath: string
  source?: unknown
}
type CodexSessionMeta = Omit<CodexSessionFile, 'filePath'>
const FIRST_LINE_READ_CHUNK_BYTES = 4096
const FIRST_LINE_MAX_BYTES = 64 * 1024

async function readFirstLine(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(filePath, 'r')
    const decoder = new StringDecoder('utf8')
    const buffer = Buffer.allocUnsafe(FIRST_LINE_READ_CHUNK_BYTES)
    let bytesReadTotal = 0
    let remainder = ''

    while (bytesReadTotal < FIRST_LINE_MAX_BYTES) {
      const bytesToRead = Math.min(buffer.length, FIRST_LINE_MAX_BYTES - bytesReadTotal)
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, null)
      if (bytesRead <= 0) {
        break
      }

      bytesReadTotal += bytesRead

      const textChunk = decoder.write(buffer.subarray(0, bytesRead))
      if (textChunk.length === 0) {
        continue
      }

      const merged = `${remainder}${textChunk}`
      const newlineIndex = merged.indexOf('\n')
      if (newlineIndex !== -1) {
        const line = merged.slice(0, newlineIndex).trim()
        return line.length > 0 ? line : null
      }

      remainder = merged
    }

    if (bytesReadTotal >= FIRST_LINE_MAX_BYTES) {
      return null
    }

    const finalLine = `${remainder}${decoder.end()}`.trim()
    return finalLine.length > 0 ? finalLine : null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value !== 'string') {
    return null
  }

  const timestampMs = Date.parse(value)
  return Number.isFinite(timestampMs) ? timestampMs : null
}

function parseCodexSessionMeta(firstLine: string): CodexSessionMeta | null {
  try {
    const parsed = JSON.parse(firstLine) as {
      type?: unknown
      timestamp?: unknown
      payload?: {
        id?: unknown
        cwd?: unknown
        timestamp?: unknown
        source?: unknown
      }
    }

    if (parsed.type !== 'session_meta') {
      return null
    }

    const sessionId = typeof parsed.payload?.id === 'string' ? parsed.payload.id.trim() : ''
    const sessionCwd = typeof parsed.payload?.cwd === 'string' ? resolve(parsed.payload.cwd) : null
    const payloadTimestampMs = parseTimestampMs(parsed.payload?.timestamp)
    const recordTimestampMs = parseTimestampMs(parsed.timestamp)

    if (
      sessionId.length === 0 ||
      !sessionCwd ||
      (payloadTimestampMs === null && recordTimestampMs === null)
    ) {
      return null
    }

    return {
      sessionId,
      cwd: sessionCwd,
      payloadTimestampMs,
      recordTimestampMs,
      source: parsed.payload?.source,
    }
  } catch {
    return null
  }
}

export function resolveCodexSessionTimestampMs(
  meta: CodexSessionMeta,
  startedAtMs: number,
): number {
  const candidates = [meta.payloadTimestampMs, meta.recordTimestampMs].filter(
    (value): value is number => typeof value === 'number',
  )

  if (candidates.length === 0) {
    return startedAtMs
  }

  return candidates.sort(
    (left, right) => Math.abs(left - startedAtMs) - Math.abs(right - startedAtMs),
  )[0]
}

export async function listCodexSessionFiles(input: {
  cwd: string
  startedAtMs: number
  codexHomeDirectories?: readonly string[]
  sessionId?: string | null
}): Promise<CodexSessionFile[]> {
  const homes = input.codexHomeDirectories ?? resolveCodexHomeDirectoryCandidates()
  const files = new Set<string>()
  for (const home of homes) {
    if (input.sessionId) {
      // Resume IDs can refer to years-old rollouts. Read only matching filenames, then
      // verify session_meta; neither recent mtime nor today's date is a resume authority.
      // eslint-disable-next-line no-await-in-loop
      const entries = await fs
        .readdir(join(home, 'sessions'), { recursive: true, withFileTypes: true })
        .catch(() => [])
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(`-${input.sessionId}.jsonl`)) {
          files.add(join(entry.parentPath, entry.name))
        }
      }
      continue
    }
    const directories = new Set<string>()
    for (const timestamp of [
      input.startedAtMs,
      input.startedAtMs - 86_400_000,
      Date.now(),
      Date.now() - 86_400_000,
    ]) {
      const date = new Date(timestamp)
      directories.add(
        join(
          home,
          'sessions',
          String(date.getFullYear()),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0'),
        ),
      )
    }
    for (const directory of directories) {
      // eslint-disable-next-line no-await-in-loop
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
          files.add(join(directory, entry.name))
        }
      }
    }
  }
  const candidates: CodexSessionFile[] = []
  for (const filePath of files) {
    // Keep reads bounded and sequential: a large history must not exhaust file handles.
    // eslint-disable-next-line no-await-in-loop
    const line = await readFirstLine(filePath)
    const meta = line ? parseCodexSessionMeta(line) : null
    if (
      !meta ||
      (input.sessionId
        ? meta.sessionId !== input.sessionId
        : normalizeCwd(meta.cwd) !== normalizeCwd(input.cwd))
    ) {
      continue
    }
    candidates.push({ ...meta, filePath })
  }
  return candidates
}

function normalizeCwd(cwd: string): string {
  const path = resolve(cwd)
  return process.platform === 'win32' ? path.toLowerCase() : path
}
