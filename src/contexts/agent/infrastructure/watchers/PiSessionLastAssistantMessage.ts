import { PI_SUPPORTED_SESSION_VERSION } from './PiSessionStateDetector'
import { extractLastAssistantMessageFromSessionData } from './SessionLastAssistantMessage.extractors'

interface PiEntry extends Record<string, unknown> {
  id: string
  parentId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readSavedBranch(content: string): PiEntry[] {
  const entries = new Map<string, PiEntry>()
  let headerSeen = false
  let leaf: PiEntry | undefined
  for (const line of content.split(/\r?\n/u)) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      // A concurrent append may leave an incomplete final line.
      continue
    }
    if (!isRecord(record)) {
      continue
    }
    if (!headerSeen) {
      if (record.type !== 'session' || record.version !== PI_SUPPORTED_SESSION_VERSION) {
        return []
      }
      headerSeen = true
      continue
    }
    if (
      record.type === 'session' ||
      typeof record.id !== 'string' ||
      record.id.length === 0 ||
      !(record.parentId === null || typeof record.parentId === 'string')
    ) {
      continue
    }
    leaf = { ...record, id: record.id, parentId: record.parentId }
    entries.set(leaf.id, leaf)
  }

  const branch: PiEntry[] = []
  const visited = new Set<string>()
  while (leaf) {
    if (visited.has(leaf.id)) {
      return []
    }
    visited.add(leaf.id)
    branch.push(leaf)
    leaf = leaf.parentId === null ? undefined : entries.get(leaf.parentId)
  }
  return branch.reverse()
}

/** Pi owns the live leaf in memory. File reads follow its restart branch: the last saved entry.
 * All entry types retain their ancestry, but summaries and tool results are never reply text.
 */
export function extractPiLastAssistantMessage(content: string): string | null {
  const branch = readSavedBranch(content)
  const compactionIndex = branch.findLastIndex(entry => entry.type === 'compaction')
  const firstKeptId = branch[compactionIndex]?.firstKeptEntryId
  const firstKeptIndex = branch.findIndex(
    (entry, index) => index < compactionIndex && entry.id === firstKeptId,
  )
  const startIndex =
    compactionIndex < 0 ? 0 : firstKeptIndex >= 0 ? firstKeptIndex : compactionIndex

  for (let index = branch.length - 1; index >= startIndex; index -= 1) {
    const entry = branch[index]
    if (
      entry.type !== 'message' ||
      !isRecord(entry.message) ||
      entry.message.role !== 'assistant'
    ) {
      continue
    }
    if (
      entry.message.stopReason === 'aborted' &&
      (entry.message.content === null ||
        entry.message.content === undefined ||
        (Array.isArray(entry.message.content) && entry.message.content.length === 0))
    ) {
      continue
    }
    // A tool-only/thinking-only latest assistant is not an excuse to copy an older answer.
    return extractLastAssistantMessageFromSessionData('pi', entry)
  }
  return null
}
