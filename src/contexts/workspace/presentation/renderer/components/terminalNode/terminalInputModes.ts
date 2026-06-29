export interface TerminalInputModeTracker {
  handlePtyOutputChunk: (data: string) => void
  isBracketedPasteMode: () => boolean
}

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

function updateBracketedPasteModeFromCsiSequence(
  sequence: { finalByte: string; payload: string },
  current: boolean,
): boolean {
  if (sequence.finalByte !== 'h' && sequence.finalByte !== 'l') {
    return current
  }

  if (!sequence.payload.startsWith('?')) {
    return current
  }

  const modes = sequence.payload
    .slice(1)
    .split(';')
    .map(value => Number(value))

  if (!modes.includes(2004)) {
    return current
  }

  return sequence.finalByte === 'h'
}

export function createTerminalInputModeTracker(): TerminalInputModeTracker {
  let bracketedPasteMode = false
  let tail = ''

  const handlePtyOutputChunk = (data: string): void => {
    if (data.length === 0) {
      return
    }

    const combined = `${tail}${data}`
    let cursor = 0
    while (cursor < combined.length) {
      const nextCsiIndex = combined.indexOf('\u001b[', cursor)
      if (nextCsiIndex === -1) {
        break
      }

      const sequence = readCsiSequence(combined, nextCsiIndex)
      if (!sequence) {
        break
      }

      bracketedPasteMode = updateBracketedPasteModeFromCsiSequence(sequence, bracketedPasteMode)
      cursor = sequence.endIndex + 1
    }

    tail = combined.slice(-32)
  }

  return {
    handlePtyOutputChunk,
    isBracketedPasteMode: () => bracketedPasteMode,
  }
}
