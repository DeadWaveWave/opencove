function consumeUntilStringTerminator(data: string, index: number): number {
  let cursor = index

  while (cursor < data.length) {
    const code = data.charCodeAt(cursor)
    if (code === 0x07) {
      return cursor + 1
    }

    if (code === 0x1b && data.charCodeAt(cursor + 1) === 0x5c) {
      return cursor + 2
    }

    cursor += 1
  }

  return cursor
}

function consumeUntilStTerminator(data: string, index: number): number {
  let cursor = index

  while (cursor < data.length) {
    if (data.charCodeAt(cursor) === 0x1b && data.charCodeAt(cursor + 1) === 0x5c) {
      return cursor + 2
    }

    cursor += 1
  }

  return cursor
}

const DESTRUCTIVE_TERMINAL_DISPLAY_CONTROL_SEQUENCES = [
  '\u001b[?1049h',
  '\u001b[?1049l',
  '\u001b[?1047h',
  '\u001b[?1047l',
  '\u001b[?47h',
  '\u001b[?47l',
  '\u001b[J',
  '\u001b[0J',
  '\u001b[1J',
  '\u001b[2J',
  '\u001b[3J',
  '\u001b[K',
  '\u001b[0K',
  '\u001b[1K',
  '\u001b[2K',
] as const

export function containsDestructiveTerminalDisplayControlSequence(data: string): boolean {
  return (
    data.includes('\u001bc') ||
    DESTRUCTIVE_TERMINAL_DISPLAY_CONTROL_SEQUENCES.some(sequence => data.includes(sequence))
  )
}

export function containsMeaningfulTerminalDisplayContent(data: string): boolean {
  let index = 0

  while (index < data.length) {
    const code = data.charCodeAt(index)

    if (code === 0x1b) {
      const next = data.charCodeAt(index + 1)

      if (next === 0x5b) {
        index += 2
        while (index < data.length) {
          const finalByte = data.charCodeAt(index)
          index += 1
          if (finalByte >= 0x40 && finalByte <= 0x7e) {
            break
          }
        }
        continue
      }

      if (next === 0x5d) {
        index = consumeUntilStringTerminator(data, index + 2)
        continue
      }

      if (next === 0x50 || next === 0x5f || next === 0x5e || next === 0x58) {
        index = consumeUntilStTerminator(data, index + 2)
        continue
      }

      index = Math.min(data.length, index + 2)
      continue
    }

    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      index += 1
      continue
    }

    const codePoint = data.codePointAt(index)
    if (codePoint === undefined) {
      break
    }

    const char = String.fromCodePoint(codePoint)
    if (!/\s/u.test(char)) {
      return true
    }

    index += codePoint > 0xffff ? 2 : 1
  }

  return false
}

export function shouldReplacePlaceholderWithBufferedOutput({
  data,
  exitCode,
}: {
  data: string
  exitCode: number | null
}): boolean {
  return exitCode !== null || containsMeaningfulTerminalDisplayContent(data)
}

export function shouldDeferHydratedTerminalRedrawChunk(data: string): boolean {
  return (
    containsDestructiveTerminalDisplayControlSequence(data) &&
    !containsMeaningfulTerminalDisplayContent(data)
  )
}
