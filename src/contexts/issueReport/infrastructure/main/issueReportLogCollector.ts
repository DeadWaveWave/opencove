import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { IssueReportLogExcerpt } from '../../application/IssueReportDocument'

export const LOG_SAMPLE_BYTES = 128 * 1024
const LOG_SCAN_BYTES = 2 * 1024 * 1024
const MAX_EVENT_TYPES = 160
export const ISSUE_REPORT_LOG_FILE_NAMES = ['runtime-diagnostics.log', 'pty-host.log'] as const

interface IndexedLine {
  index: number
  value: string
  bytes: number
  eventType: string
}

function eventTypeForLine(line: string): string {
  try {
    const parsed = JSON.parse(line) as { source?: unknown; event?: unknown }
    const source = typeof parsed.source === 'string' ? parsed.source : 'unknown-source'
    const event = typeof parsed.event === 'string' ? parsed.event : 'unknown-event'
    return `${source}:${event}`
  } catch {
    return 'unparsed'
  }
}

export function sampleLogLinesByEventType(content: string, maxBytes = LOG_SAMPLE_BYTES): string {
  const lines = content
    .split(/\r?\n/u)
    .filter(line => line.trim().length > 0)
    .map(
      (value, index): IndexedLine => ({
        index,
        value,
        bytes: Buffer.byteLength(`${value}\n`, 'utf8'),
        eventType: eventTypeForLine(value),
      }),
    )
  const selected = new Set<number>()
  const latestByEventType = new Map<string, IndexedLine>()
  for (const line of lines) {
    latestByEventType.set(line.eventType, line)
  }

  let usedBytes = 0
  const eventRepresentatives = [...latestByEventType.values()]
    .sort((left, right) => right.index - left.index)
    .slice(0, MAX_EVENT_TYPES)
  for (const line of eventRepresentatives) {
    if (usedBytes + line.bytes > maxBytes) {
      continue
    }
    selected.add(line.index)
    usedBytes += line.bytes
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!line || selected.has(line.index) || usedBytes + line.bytes > maxBytes) {
      continue
    }
    selected.add(line.index)
    usedBytes += line.bytes
  }

  return lines
    .filter(line => selected.has(line.index))
    .map(line => line.value)
    .join('\n')
}

function createLogExcerpt(input: {
  fileName: string
  filePath: string
  status: IssueReportLogExcerpt['status']
  error?: string | null
}): IssueReportLogExcerpt {
  return {
    fileName: input.fileName,
    path: input.filePath,
    status: input.status,
    content: '',
    originalBytes: input.status === 'empty' ? 0 : null,
    includedBytes: 0,
    omittedBytes: 0,
    truncated: false,
    tail: false,
    ...(input.error ? { error: input.error } : {}),
  }
}

export async function readIssueReportLog(
  userDataPath: string,
  fileName: string,
): Promise<IssueReportLogExcerpt> {
  const filePath = resolve(userDataPath, 'logs', fileName)
  let file: Awaited<ReturnType<typeof open>> | null = null
  try {
    file = await open(filePath, 'r')
    const stat = await file.stat()
    if (stat.size === 0) {
      return createLogExcerpt({ fileName, filePath, status: 'empty' })
    }

    const scanLength = Math.min(stat.size, LOG_SCAN_BYTES)
    const buffer = Buffer.alloc(scanLength)
    await file.read(buffer, 0, scanLength, Math.max(0, stat.size - scanLength))
    const sampled = sampleLogLinesByEventType(buffer.toString('utf8'))
    const includedBytes = Buffer.byteLength(sampled, 'utf8')
    return {
      fileName,
      path: filePath,
      status: 'available',
      content: sampled,
      originalBytes: stat.size,
      includedBytes,
      omittedBytes: Math.max(0, stat.size - includedBytes),
      truncated: stat.size > includedBytes,
      tail: false,
      sampling: 'event-type-priority',
    }
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : null
    return createLogExcerpt({
      fileName,
      filePath,
      status: code === 'ENOENT' ? 'missing' : 'read_failed',
      error: code === 'ENOENT' ? null : error instanceof Error ? error.message : String(error),
    })
  } finally {
    await file?.close().catch(() => undefined)
  }
}

export async function collectIssueReportLogExcerpts(
  userDataPath: string,
): Promise<IssueReportLogExcerpt[]> {
  return await Promise.all(
    ISSUE_REPORT_LOG_FILE_NAMES.map(fileName => readIssueReportLog(userDataPath, fileName)),
  )
}
