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

function consumeCaretEscapedControlSequence(data: string, index: number): number | null {
  if (!data.startsWith('^[', index)) {
    return null
  }

  const introducerIndex = index + 2
  const introducer = data.charCodeAt(introducerIndex)
  if (Number.isNaN(introducer)) {
    return data.length
  }

  if (introducer === 0x5b) {
    let cursor = introducerIndex + 1
    while (cursor < data.length) {
      const finalByte = data.charCodeAt(cursor)
      cursor += 1
      if (finalByte >= 0x40 && finalByte <= 0x7e) {
        return cursor
      }
    }
    return data.length
  }

  if (introducer === 0x5d) {
    let cursor = introducerIndex + 1
    while (cursor < data.length) {
      if (data.startsWith('^G', cursor)) {
        return cursor + 2
      }
      if (data.startsWith('^[\\', cursor)) {
        return cursor + 3
      }
      const code = data.charCodeAt(cursor)
      if (code === 0x07) {
        return cursor + 1
      }
      if (code === 0x1b && data.charCodeAt(cursor + 1) === 0x5c) {
        return cursor + 2
      }
      cursor += 1
    }
    return data.length
  }

  if (introducer === 0x50 || introducer === 0x5f || introducer === 0x5e || introducer === 0x58) {
    let cursor = introducerIndex + 1
    while (cursor < data.length) {
      if (data.startsWith('^[\\', cursor)) {
        return cursor + 3
      }
      if (data.charCodeAt(cursor) === 0x1b && data.charCodeAt(cursor + 1) === 0x5c) {
        return cursor + 2
      }
      cursor += 1
    }
    return data.length
  }

  return introducerIndex + 1
}

export function stripEchoedTerminalControlSequences(data: string): string {
  if (!data.includes('^[')) {
    return data
  }

  let index = 0
  let result = ''

  while (index < data.length) {
    const nextIndex = data.indexOf('^[', index)
    if (nextIndex === -1) {
      result += data.slice(index)
      break
    }

    result += data.slice(index, nextIndex)
    const consumedEnd = consumeCaretEscapedControlSequence(data, nextIndex)
    if (consumedEnd === null) {
      result += data.charAt(nextIndex)
      index = nextIndex + 1
      continue
    }

    index = consumedEnd
  }

  return result
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

const FULL_SCREEN_TERMINAL_DISPLAY_CONTROL_SEQUENCES = [
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
] as const

function resolveLastDestructiveTerminalDisplayControlSequenceEnd(data: string): number {
  let lastStart = -1
  let lastEnd = -1

  for (const sequence of ['\u001bc', ...DESTRUCTIVE_TERMINAL_DISPLAY_CONTROL_SEQUENCES]) {
    const start = data.lastIndexOf(sequence)
    if (start > lastStart) {
      lastStart = start
      lastEnd = start + sequence.length
    }
  }

  return lastEnd
}

export function containsDestructiveTerminalDisplayControlSequence(data: string): boolean {
  return (
    data.includes('\u001bc') ||
    DESTRUCTIVE_TERMINAL_DISPLAY_CONTROL_SEQUENCES.some(sequence => data.includes(sequence))
  )
}

function containsFullScreenTerminalDisplayControlSequence(data: string): boolean {
  return (
    data.includes('\u001bc') ||
    FULL_SCREEN_TERMINAL_DISPLAY_CONTROL_SEQUENCES.some(sequence => data.includes(sequence))
  )
}

export function containsMeaningfulTerminalDisplayContent(data: string): boolean {
  let index = 0

  while (index < data.length) {
    const code = data.charCodeAt(index)

    const caretEscapedControlEnd = consumeCaretEscapedControlSequence(data, index)
    if (caretEscapedControlEnd !== null) {
      index = caretEscapedControlEnd
      continue
    }

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

export function containsMeaningfulTerminalDisplayContentAfterLastDestructiveSequence(
  data: string,
): boolean {
  const destructiveSequenceEnd = resolveLastDestructiveTerminalDisplayControlSequenceEnd(data)
  const visibleRegion = destructiveSequenceEnd >= 0 ? data.slice(destructiveSequenceEnd) : data

  return containsMeaningfulTerminalDisplayContent(visibleRegion)
}

export function endsWithIncompleteTerminalControlSequence(data: string): boolean {
  let index = 0

  while (index < data.length) {
    const code = data.charCodeAt(index)

    if (code !== 0x1b) {
      index += 1
      continue
    }

    const next = data.charCodeAt(index + 1)
    if (Number.isNaN(next)) {
      return true
    }

    if (next === 0x5b) {
      index += 2
      let foundFinalByte = false
      while (index < data.length) {
        const finalByte = data.charCodeAt(index)
        index += 1
        if (finalByte >= 0x40 && finalByte <= 0x7e) {
          foundFinalByte = true
          break
        }
      }
      if (!foundFinalByte) {
        return true
      }
      continue
    }

    if (next === 0x5d) {
      let cursor = index + 2
      let foundTerminator = false
      while (cursor < data.length) {
        const cursorCode = data.charCodeAt(cursor)
        if (cursorCode === 0x07) {
          cursor += 1
          foundTerminator = true
          break
        }
        if (cursorCode === 0x1b && data.charCodeAt(cursor + 1) === 0x5c) {
          cursor += 2
          foundTerminator = true
          break
        }
        cursor += 1
      }
      if (!foundTerminator) {
        return true
      }
      index = cursor
      continue
    }

    if (next === 0x50 || next === 0x5f || next === 0x5e || next === 0x58) {
      let cursor = index + 2
      let foundTerminator = false
      while (cursor < data.length) {
        if (data.charCodeAt(cursor) === 0x1b && data.charCodeAt(cursor + 1) === 0x5c) {
          cursor += 2
          foundTerminator = true
          break
        }
        cursor += 1
      }
      if (!foundTerminator) {
        return true
      }
      index = cursor
      continue
    }

    index += 2
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
  return (
    exitCode !== null || containsMeaningfulTerminalDisplayContentAfterLastDestructiveSequence(data)
  )
}

export function shouldDeferHydratedTerminalRedrawChunk(data: string): boolean {
  return (
    containsFullScreenTerminalDisplayControlSequence(data) &&
    !containsMeaningfulTerminalDisplayContent(data)
  )
}
