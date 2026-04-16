const CSI_PREFIX = '\u001b['

const AUTOMATIC_TERMINAL_QUERY_SEQUENCES = [
  { pattern: /^6n$/u, reply: '\u001b[1;1R' },
  { pattern: /^\?6n$/u, reply: '\u001b[?1;1R' },
  { pattern: /^c$/u, reply: '\u001b[?1;2c' },
  { pattern: /^>c$/u, reply: '\u001b[>0;115;0c' },
  { pattern: /^\?u$/u, reply: '\u001b[?0u' },
] as const

const AUTOMATIC_TERMINAL_REPLY_PATTERNS = [
  /^\d+;\d+R$/u,
  /^\?\d+;\d+R$/u,
  /^\?\d+(?:;\d+)*c$/u,
  /^>\d+(?:;\d+)*c$/u,
  /^\?\d+(?:;\d+)*u$/u,
] as const

function isCsiFinalByte(charCode: number): boolean {
  return charCode >= 0x40 && charCode <= 0x7e
}

function readCsiSequence(
  data: string,
  startIndex: number,
): { payload: string; endIndex: number } | null {
  if (!data.startsWith(CSI_PREFIX, startIndex)) {
    return null
  }

  let endIndex = startIndex + CSI_PREFIX.length
  while (endIndex < data.length && !isCsiFinalByte(data.charCodeAt(endIndex))) {
    endIndex += 1
  }

  if (endIndex >= data.length) {
    return null
  }

  return {
    payload: data.slice(startIndex + CSI_PREFIX.length, endIndex + 1),
    endIndex,
  }
}

function matchesRecognizedCsiSequenceChunk(data: string, patterns: readonly RegExp[]): boolean {
  if (!data.startsWith(CSI_PREFIX)) {
    return false
  }

  let cursor = 0
  let sawRecognizedSequence = false

  while (cursor < data.length) {
    const sequence = readCsiSequence(data, cursor)
    if (!sequence) {
      return false
    }

    if (!patterns.some(pattern => pattern.test(sequence.payload))) {
      return false
    }

    sawRecognizedSequence = true
    cursor = sequence.endIndex + 1
  }

  return sawRecognizedSequence
}

function resolveAutomaticTerminalQueryReply(payload: string): string | null {
  const match = AUTOMATIC_TERMINAL_QUERY_SEQUENCES.find(sequence => sequence.pattern.test(payload))
  return match?.reply ?? null
}

export function isAutomaticTerminalQuery(data: string): boolean {
  return matchesRecognizedCsiSequenceChunk(
    data,
    AUTOMATIC_TERMINAL_QUERY_SEQUENCES.map(sequence => sequence.pattern),
  )
}

export function isAutomaticTerminalReply(data: string): boolean {
  return matchesRecognizedCsiSequenceChunk(data, AUTOMATIC_TERMINAL_REPLY_PATTERNS)
}

export function stripAutomaticTerminalQueriesFromOutput(data: string): {
  visibleData: string
  replies: string[]
} {
  if (!data.includes(CSI_PREFIX)) {
    return { visibleData: data, replies: [] }
  }

  let cursor = 0
  const visibleParts: string[] = []
  const replies: string[] = []

  while (cursor < data.length) {
    const nextSequenceIndex = data.indexOf(CSI_PREFIX, cursor)
    if (nextSequenceIndex === -1) {
      visibleParts.push(data.slice(cursor))
      break
    }

    if (nextSequenceIndex > cursor) {
      visibleParts.push(data.slice(cursor, nextSequenceIndex))
    }

    const sequence = readCsiSequence(data, nextSequenceIndex)
    if (!sequence) {
      visibleParts.push(data.slice(nextSequenceIndex))
      break
    }

    const reply = resolveAutomaticTerminalQueryReply(sequence.payload)
    if (reply) {
      replies.push(reply)
    } else {
      visibleParts.push(data.slice(nextSequenceIndex, sequence.endIndex + 1))
    }

    cursor = sequence.endIndex + 1
  }

  return {
    visibleData: visibleParts.join(''),
    replies,
  }
}
