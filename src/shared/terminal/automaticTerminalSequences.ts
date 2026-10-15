const CSI_PREFIX = '\u001b['
const OSC_PREFIX = '\u001b]'
const OSC_STRING_TERMINATOR = '\u001b\\'

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
  /^\?\d+(?:;\d+)*\$y$/u,
] as const

const TERMINAL_COLOR_VALUE_PATTERN = String.raw`(?:rgb|rgba):[0-9a-fA-F]{1,4}(?:/[0-9a-fA-F]{1,4}){2,3}`

const AUTOMATIC_TERMINAL_OSC_REPLY_PATTERNS = [
  new RegExp(String.raw`^(?:1[0-9]|[4-9]);${TERMINAL_COLOR_VALUE_PATTERN}$`, 'u'),
  new RegExp(String.raw`^4;\d+;${TERMINAL_COLOR_VALUE_PATTERN}$`, 'u'),
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

function readOscSequence(
  data: string,
  startIndex: number,
): { payload: string; endIndex: number } | null {
  if (!data.startsWith(OSC_PREFIX, startIndex)) {
    return null
  }

  const payloadStart = startIndex + OSC_PREFIX.length
  const bellEndIndex = data.indexOf('\u0007', payloadStart)
  const stEndIndex = data.indexOf(OSC_STRING_TERMINATOR, payloadStart)

  if (bellEndIndex === -1 && stEndIndex === -1) {
    return null
  }

  const useBell = bellEndIndex !== -1 && (stEndIndex === -1 || bellEndIndex < stEndIndex)
  const payloadEndIndex = useBell ? bellEndIndex : stEndIndex

  return {
    payload: data.slice(payloadStart, payloadEndIndex),
    endIndex: payloadEndIndex + (useBell ? 0 : OSC_STRING_TERMINATOR.length - 1),
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

function matchesRecognizedTerminalReplyChunk(data: string): boolean {
  if (!data.startsWith('\u001b')) {
    return false
  }

  let cursor = 0
  let sawRecognizedSequence = false

  while (cursor < data.length) {
    const csiSequence = readCsiSequence(data, cursor)
    if (csiSequence) {
      if (!AUTOMATIC_TERMINAL_REPLY_PATTERNS.some(pattern => pattern.test(csiSequence.payload))) {
        return false
      }

      sawRecognizedSequence = true
      cursor = csiSequence.endIndex + 1
      continue
    }

    const oscSequence = readOscSequence(data, cursor)
    if (oscSequence) {
      if (
        !AUTOMATIC_TERMINAL_OSC_REPLY_PATTERNS.some(pattern => pattern.test(oscSequence.payload))
      ) {
        return false
      }

      sawRecognizedSequence = true
      cursor = oscSequence.endIndex + 1
      continue
    }

    return false
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
  return matchesRecognizedTerminalReplyChunk(data)
}

export function extractAutomaticTerminalQuerySequences(data: string): string[] {
  if (!data.includes(CSI_PREFIX)) {
    return []
  }

  let cursor = 0
  const queries: string[] = []

  while (cursor < data.length) {
    const nextSequenceIndex = data.indexOf(CSI_PREFIX, cursor)
    if (nextSequenceIndex === -1) {
      break
    }

    const sequence = readCsiSequence(data, nextSequenceIndex)
    if (!sequence) {
      break
    }

    const reply = resolveAutomaticTerminalQueryReply(sequence.payload)
    if (reply) {
      queries.push(data.slice(nextSequenceIndex, sequence.endIndex + 1))
    }

    cursor = sequence.endIndex + 1
  }

  return queries
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

// Colour queries a program sends to learn the terminal's palette (OSC 4, 10–19 with `?`).
const OSC_COLOR_QUERY_PATTERN = /^(?:4;\d+|1\d|[5-9]);\?$/u

/**
 * Removes queries from output that is being replayed into a new xterm instance. The program
 * already received its answers from the terminal that first showed this output; answering again
 * would type the reply into whatever runs now.
 */
export function stripTerminalQuerySequences(data: string): string {
  if (!data.includes('\u001b')) {
    return data
  }

  const queryPatterns = AUTOMATIC_TERMINAL_QUERY_SEQUENCES.map(sequence => sequence.pattern)
  let result = ''
  let cursor = 0
  while (cursor < data.length) {
    const escapeIndex = data.indexOf('\u001b', cursor)
    if (escapeIndex === -1) {
      result += data.slice(cursor)
      break
    }
    result += data.slice(cursor, escapeIndex)
    const csi = readCsiSequence(data, escapeIndex)
    if (csi && queryPatterns.some(pattern => pattern.test(csi.payload))) {
      cursor = csi.endIndex + 1
      continue
    }
    const osc = readOscSequence(data, escapeIndex)
    if (osc && OSC_COLOR_QUERY_PATTERN.test(osc.payload)) {
      cursor = osc.endIndex + 1
      continue
    }
    result += '\u001b'
    cursor = escapeIndex + 1
  }
  return result
}
