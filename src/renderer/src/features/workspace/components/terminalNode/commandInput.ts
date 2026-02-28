export type TerminalInputEscapeState = 'none' | 'esc' | 'csi' | 'ss3' | 'osc'

export interface TerminalCommandInputState {
  lineBuffer: string
  cursorIndex: number
  escapeState: TerminalInputEscapeState
  escapeBuffer: string
  oscSawEscape: boolean
}

export interface ParsedTerminalCommands {
  nextState: TerminalCommandInputState
  commands: string[]
}

const MAX_COMMAND_BUFFER_CHARS = 4096

export function createTerminalCommandInputState(): TerminalCommandInputState {
  return {
    lineBuffer: '',
    cursorIndex: 0,
    escapeState: 'none',
    escapeBuffer: '',
    oscSawEscape: false,
  }
}

function clampCursorIndex(buffer: string, cursorIndex: number): number {
  if (cursorIndex < 0) {
    return 0
  }

  if (cursorIndex > buffer.length) {
    return buffer.length
  }

  return cursorIndex
}

function trimBufferToMaxChars(buffer: string, cursorIndex: number): {
  nextBuffer: string
  nextCursorIndex: number
} {
  if (buffer.length <= MAX_COMMAND_BUFFER_CHARS) {
    return {
      nextBuffer: buffer,
      nextCursorIndex: clampCursorIndex(buffer, cursorIndex),
    }
  }

  const overflow = buffer.length - MAX_COMMAND_BUFFER_CHARS
  const nextBuffer = buffer.slice(overflow)
  const nextCursorIndex = clampCursorIndex(nextBuffer, cursorIndex - overflow)

  return {
    nextBuffer,
    nextCursorIndex,
  }
}

function insertCharacterAtCursor(
  buffer: string,
  cursorIndex: number,
  char: string,
): { nextBuffer: string; nextCursorIndex: number } {
  const safeCursorIndex = clampCursorIndex(buffer, cursorIndex)
  const rawBuffer = `${buffer.slice(0, safeCursorIndex)}${char}${buffer.slice(safeCursorIndex)}`
  return trimBufferToMaxChars(rawBuffer, safeCursorIndex + char.length)
}

function deleteCharacterBeforeCursor(
  buffer: string,
  cursorIndex: number,
): { nextBuffer: string; nextCursorIndex: number } {
  const safeCursorIndex = clampCursorIndex(buffer, cursorIndex)
  if (safeCursorIndex === 0) {
    return {
      nextBuffer: buffer,
      nextCursorIndex: safeCursorIndex,
    }
  }

  return {
    nextBuffer: `${buffer.slice(0, safeCursorIndex - 1)}${buffer.slice(safeCursorIndex)}`,
    nextCursorIndex: safeCursorIndex - 1,
  }
}

function deleteCharactersAtCursor(
  buffer: string,
  cursorIndex: number,
  count: number,
): { nextBuffer: string; nextCursorIndex: number } {
  const safeCursorIndex = clampCursorIndex(buffer, cursorIndex)
  const safeCount = Math.max(0, count)

  if (safeCount === 0 || safeCursorIndex >= buffer.length) {
    return {
      nextBuffer: buffer,
      nextCursorIndex: safeCursorIndex,
    }
  }

  return {
    nextBuffer: `${buffer.slice(0, safeCursorIndex)}${buffer.slice(safeCursorIndex + safeCount)}`,
    nextCursorIndex: safeCursorIndex,
  }
}

function deletePreviousWordAtCursor(
  buffer: string,
  cursorIndex: number,
): { nextBuffer: string; nextCursorIndex: number } {
  const safeCursorIndex = clampCursorIndex(buffer, cursorIndex)
  let index = safeCursorIndex

  while (index > 0 && /\s/.test(buffer[index - 1] ?? '')) {
    index -= 1
  }

  while (index > 0 && !/\s/.test(buffer[index - 1] ?? '')) {
    index -= 1
  }

  return {
    nextBuffer: `${buffer.slice(0, index)}${buffer.slice(safeCursorIndex)}`,
    nextCursorIndex: index,
  }
}

function parsePrimaryCsiParam(params: string): number | null {
  const [firstParam] = params.split(';')
  if (!firstParam || firstParam.length === 0) {
    return null
  }

  if (!/^\d+$/.test(firstParam)) {
    return null
  }

  const numeric = Number.parseInt(firstParam, 10)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null
  }

  return numeric
}

function resolveCsiMoveCount(params: string): number {
  return parsePrimaryCsiParam(params) ?? 1
}

function applyCsiSequence(
  sequence: string,
  buffer: string,
  cursorIndex: number,
): { nextBuffer: string; nextCursorIndex: number } {
  if (sequence.length === 0) {
    return {
      nextBuffer: buffer,
      nextCursorIndex: clampCursorIndex(buffer, cursorIndex),
    }
  }

  const finalChar = sequence.slice(-1)
  const params = sequence.slice(0, -1)
  const safeCursorIndex = clampCursorIndex(buffer, cursorIndex)

  if (finalChar === 'D') {
    return {
      nextBuffer: buffer,
      nextCursorIndex: Math.max(0, safeCursorIndex - resolveCsiMoveCount(params)),
    }
  }

  if (finalChar === 'C') {
    return {
      nextBuffer: buffer,
      nextCursorIndex: Math.min(buffer.length, safeCursorIndex + resolveCsiMoveCount(params)),
    }
  }

  if (finalChar === 'H') {
    return {
      nextBuffer: buffer,
      nextCursorIndex: 0,
    }
  }

  if (finalChar === 'F') {
    return {
      nextBuffer: buffer,
      nextCursorIndex: buffer.length,
    }
  }

  if (finalChar === 'P') {
    const deleteCount = resolveCsiMoveCount(params)
    return deleteCharactersAtCursor(buffer, safeCursorIndex, deleteCount)
  }

  if (finalChar === '~') {
    const primaryParam = parsePrimaryCsiParam(params)
    if (primaryParam === 1 || primaryParam === 7) {
      return {
        nextBuffer: buffer,
        nextCursorIndex: 0,
      }
    }

    if (primaryParam === 4 || primaryParam === 8) {
      return {
        nextBuffer: buffer,
        nextCursorIndex: buffer.length,
      }
    }

    if (primaryParam === 3) {
      return deleteCharactersAtCursor(buffer, safeCursorIndex, 1)
    }
  }

  return {
    nextBuffer: buffer,
    nextCursorIndex: safeCursorIndex,
  }
}

function applySs3Sequence(
  sequenceChar: string,
  buffer: string,
  cursorIndex: number,
): { nextBuffer: string; nextCursorIndex: number } {
  const safeCursorIndex = clampCursorIndex(buffer, cursorIndex)

  if (sequenceChar === 'D') {
    return {
      nextBuffer: buffer,
      nextCursorIndex: Math.max(0, safeCursorIndex - 1),
    }
  }

  if (sequenceChar === 'C') {
    return {
      nextBuffer: buffer,
      nextCursorIndex: Math.min(buffer.length, safeCursorIndex + 1),
    }
  }

  if (sequenceChar === 'H') {
    return {
      nextBuffer: buffer,
      nextCursorIndex: 0,
    }
  }

  if (sequenceChar === 'F') {
    return {
      nextBuffer: buffer,
      nextCursorIndex: buffer.length,
    }
  }

  return {
    nextBuffer: buffer,
    nextCursorIndex: safeCursorIndex,
  }
}

function pushCommand(commands: string[], lineBuffer: string): void {
  const normalized = lineBuffer.trim()
  if (normalized.length > 0) {
    commands.push(normalized)
  }
}

export function parseTerminalCommandInput(
  data: string,
  state: TerminalCommandInputState,
): ParsedTerminalCommands {
  let lineBuffer = state.lineBuffer
  let cursorIndex = clampCursorIndex(lineBuffer, state.cursorIndex)
  let escapeState = state.escapeState
  let escapeBuffer = state.escapeBuffer
  let oscSawEscape = state.oscSawEscape
  const commands: string[] = []

  for (const char of data) {
    if (escapeState === 'esc') {
      if (char === '[') {
        escapeState = 'csi'
      } else if (char === ']') {
        escapeState = 'osc'
        oscSawEscape = false
      } else if (char === 'O') {
        escapeState = 'ss3'
      } else {
        escapeState = 'none'
      }
      continue
    }

    if (escapeState === 'csi') {
      if (char >= '@' && char <= '~') {
        const applied = applyCsiSequence(`${escapeBuffer}${char}`, lineBuffer, cursorIndex)
        lineBuffer = applied.nextBuffer
        cursorIndex = applied.nextCursorIndex
        escapeState = 'none'
        escapeBuffer = ''
      } else {
        escapeBuffer += char
      }
      continue
    }

    if (escapeState === 'ss3') {
      const applied = applySs3Sequence(char, lineBuffer, cursorIndex)
      lineBuffer = applied.nextBuffer
      cursorIndex = applied.nextCursorIndex
      escapeState = 'none'
      continue
    }

    if (escapeState === 'osc') {
      if (char === '\u0007') {
        escapeState = 'none'
        oscSawEscape = false
        continue
      }

      if (oscSawEscape) {
        if (char === '\\') {
          escapeState = 'none'
          oscSawEscape = false
          continue
        }

        oscSawEscape = char === '\u001b'
        continue
      }

      if (char === '\u001b') {
        oscSawEscape = true
      }

      continue
    }

    if (char === '\u001b') {
      escapeState = 'esc'
      escapeBuffer = ''
      continue
    }

    if (char === '\r' || char === '\n') {
      pushCommand(commands, lineBuffer)
      lineBuffer = ''
      cursorIndex = 0
      continue
    }

    if (char === '\b' || char === '\u007f') {
      const deleted = deleteCharacterBeforeCursor(lineBuffer, cursorIndex)
      lineBuffer = deleted.nextBuffer
      cursorIndex = deleted.nextCursorIndex
      continue
    }

    if (char === '\u0003' || char === '\u0015') {
      lineBuffer = ''
      cursorIndex = 0
      continue
    }

    if (char === '\u0001') {
      cursorIndex = 0
      continue
    }

    if (char === '\u0005') {
      cursorIndex = lineBuffer.length
      continue
    }

    if (char === '\u0004') {
      const deleted = deleteCharactersAtCursor(lineBuffer, cursorIndex, 1)
      lineBuffer = deleted.nextBuffer
      cursorIndex = deleted.nextCursorIndex
      continue
    }

    if (char === '\u0017') {
      const deleted = deletePreviousWordAtCursor(lineBuffer, cursorIndex)
      lineBuffer = deleted.nextBuffer
      cursorIndex = deleted.nextCursorIndex
      continue
    }

    if (char >= ' ') {
      const inserted = insertCharacterAtCursor(lineBuffer, cursorIndex, char)
      lineBuffer = inserted.nextBuffer
      cursorIndex = inserted.nextCursorIndex
    }
  }

  return {
    nextState: {
      lineBuffer,
      cursorIndex,
      escapeState,
      escapeBuffer,
      oscSawEscape,
    },
    commands,
  }
}
