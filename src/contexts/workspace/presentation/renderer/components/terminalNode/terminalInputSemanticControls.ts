const INPUT_SEMANTIC_DEC_PRIVATE_MODES = new Set([1000, 1002, 1003, 1004, 1005, 1006, 1015, 2004])

function readCsiSequence(
  data: string,
  startIndex: number,
): { endIndex: number; finalByte: string; payload: string } | null {
  if (!data.startsWith('\u001b[', startIndex)) {
    return null
  }

  let cursor = startIndex + 2
  while (cursor < data.length) {
    const finalByte = data.charCodeAt(cursor)
    if (finalByte >= 0x40 && finalByte <= 0x7e) {
      return {
        endIndex: cursor,
        finalByte: data.charAt(cursor),
        payload: data.slice(startIndex + 2, cursor),
      }
    }
    cursor += 1
  }

  return null
}

function isInputSemanticDecPrivateModeSequence(sequence: {
  finalByte: string
  payload: string
}): boolean {
  if (sequence.finalByte !== 'h' && sequence.finalByte !== 'l') {
    return false
  }

  if (!sequence.payload.startsWith('?')) {
    return false
  }

  const modePayload = sequence.payload.slice(1)
  if (modePayload.length === 0) {
    return false
  }

  return modePayload.split(';').every(value => {
    const mode = Number(value)
    return Number.isInteger(mode) && INPUT_SEMANTIC_DEC_PRIVATE_MODES.has(mode)
  })
}

export function isInputSemanticTerminalControlChunk(data: string): boolean {
  if (data.length === 0) {
    return false
  }

  let cursor = 0
  let sawInputSemanticSequence = false
  while (cursor < data.length) {
    const sequence = readCsiSequence(data, cursor)
    if (!sequence || !isInputSemanticDecPrivateModeSequence(sequence)) {
      return false
    }

    sawInputSemanticSequence = true
    cursor = sequence.endIndex + 1
  }

  return sawInputSemanticSequence
}
