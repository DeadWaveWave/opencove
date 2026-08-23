export const KIMI_WIRE_SUPPORTED_PROTOCOL_MAJOR = 1

export type KimiWireObservableState = 'working' | 'standby'

export type KimiWireUnobservableReason =
  | 'missing'
  | 'empty'
  | 'unparsable'
  | 'metadata_missing'
  | 'metadata_invalid'
  | 'protocol_unsupported'
  | 'state_unavailable'

export type KimiWireStateDetection =
  | { kind: 'observed'; state: KimiWireObservableState }
  | { kind: 'unobservable'; reason: KimiWireUnobservableReason }

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function protocolMajor(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null
  }
  const match = /^(\d+)(?:\.\d+)*$/u.exec(value)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}

function detectLoopEventState(event: unknown): KimiWireObservableState | null {
  if (!isRecord(event) || typeof event.type !== 'string') {
    return null
  }

  if (event.type === 'step.end') {
    if (event.finishReason === 'end_turn') {
      return 'standby'
    }
    return event.finishReason === 'tool_use' ? 'working' : null
  }

  return event.type === 'step.begin' ||
    event.type === 'content.part' ||
    event.type === 'tool.call' ||
    event.type === 'tool.result'
    ? 'working'
    : null
}

function detectRecordState(record: JsonRecord): KimiWireObservableState | null {
  if (
    record.type === 'turn.prompt' ||
    record.type === 'turn.steer' ||
    record.type === 'llm.request' ||
    record.type === 'permission.record_approval_result'
  ) {
    return 'working'
  }

  if (record.type === 'turn.cancel') {
    return 'standby'
  }

  if (
    record.type === 'context.append_message' &&
    isRecord(record.message) &&
    record.message.role === 'user'
  ) {
    return 'working'
  }

  return record.type === 'context.append_loop_event' ? detectLoopEventState(record.event) : null
}

export function detectKimiWireState(content: string | null): KimiWireStateDetection {
  if (content === null) {
    return { kind: 'unobservable', reason: 'missing' }
  }
  if (content.trim().length === 0) {
    return { kind: 'unobservable', reason: 'empty' }
  }

  let parseableRecords = 0
  let metadataSeen = false
  let invalidMetadata = false
  let unsupportedProtocol = false
  let latestState: KimiWireObservableState | null = null

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

    if (parsed.type === 'metadata') {
      metadataSeen = true
      const major = protocolMajor(parsed.protocol_version)
      if (major === null) {
        invalidMetadata = true
      } else if (major !== KIMI_WIRE_SUPPORTED_PROTOCOL_MAJOR) {
        unsupportedProtocol = true
      }
      continue
    }

    const state = detectRecordState(parsed)
    if (state) {
      latestState = state
    }
  }

  if (parseableRecords === 0) {
    return { kind: 'unobservable', reason: 'unparsable' }
  }
  if (!metadataSeen) {
    return { kind: 'unobservable', reason: 'metadata_missing' }
  }
  if (invalidMetadata) {
    return { kind: 'unobservable', reason: 'metadata_invalid' }
  }
  if (unsupportedProtocol) {
    return { kind: 'unobservable', reason: 'protocol_unsupported' }
  }
  return latestState
    ? { kind: 'observed', state: latestState }
    : { kind: 'unobservable', reason: 'state_unavailable' }
}
