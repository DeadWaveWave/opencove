export const PI_SUPPORTED_SESSION_VERSION = 3

export type PiObservableState = 'working' | 'standby'

export type PiUnobservableReason =
  | 'missing'
  | 'empty'
  | 'unparsable'
  | 'header_missing'
  | 'header_invalid'
  | 'version_unsupported'
  | 'state_unavailable'

export type PiSessionStateDetection =
  | { kind: 'observed'; state: PiObservableState }
  | { kind: 'unobservable'; reason: PiUnobservableReason }

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasToolCall(message: JsonRecord): boolean {
  return (
    Array.isArray(message.content) &&
    message.content.some(block => isRecord(block) && block.type === 'toolCall')
  )
}

function detectMessageState(record: JsonRecord): PiObservableState | null {
  if (record.type !== 'message' || !isRecord(record.message)) {
    return null
  }

  const message = record.message
  if (message.role === 'user' || message.role === 'toolResult') {
    return 'working'
  }

  if (message.role !== 'assistant') {
    return null
  }

  if (
    message.stopReason === 'toolUse' ||
    message.stopReason === 'pending' ||
    message.stopReason === 'deferred'
  ) {
    return 'working'
  }

  if (
    message.stopReason === 'stop' ||
    message.stopReason === 'length' ||
    message.stopReason === 'error' ||
    message.stopReason === 'aborted'
  ) {
    return 'standby'
  }

  return hasToolCall(message) ? 'working' : null
}

export function detectPiSessionState(content: string | null): PiSessionStateDetection {
  if (content === null) {
    return { kind: 'unobservable', reason: 'missing' }
  }
  if (content.trim().length === 0) {
    return { kind: 'unobservable', reason: 'empty' }
  }

  let parseableRecords = 0
  let headerSeen = false
  let invalidHeader = false
  let unsupportedVersion = false
  let latestState: PiObservableState | null = null

  for (const line of content.split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(parsed)) {
      continue
    }
    parseableRecords += 1

    if (parsed.type === 'session') {
      headerSeen = true
      if (typeof parsed.version !== 'number') {
        invalidHeader = true
      } else if (parsed.version !== PI_SUPPORTED_SESSION_VERSION) {
        unsupportedVersion = true
      }
      if (typeof parsed.id !== 'string' || typeof parsed.cwd !== 'string') {
        invalidHeader = true
      }
      continue
    }

    const state = detectMessageState(parsed)
    if (state) {
      latestState = state
    }
  }

  if (parseableRecords === 0) {
    return { kind: 'unobservable', reason: 'unparsable' }
  }
  if (!headerSeen) {
    return { kind: 'unobservable', reason: 'header_missing' }
  }
  if (invalidHeader) {
    return { kind: 'unobservable', reason: 'header_invalid' }
  }
  if (unsupportedVersion) {
    return { kind: 'unobservable', reason: 'version_unsupported' }
  }
  return latestState
    ? { kind: 'observed', state: latestState }
    : { kind: 'unobservable', reason: 'state_unavailable' }
}
