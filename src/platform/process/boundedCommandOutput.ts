const TRUNCATION_NOTICE = '[output truncated]\n'

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk)
  }
  return Buffer.from(String(chunk), 'utf8')
}

function trimLeadingUtf8ContinuationBytes(value: Buffer): Buffer {
  let start = 0
  while (start < value.length && (value[start]! & 0xc0) === 0x80) {
    start += 1
  }
  return start === 0 ? value : value.subarray(start)
}

export interface CommandOutputCapture {
  append: (chunk: unknown) => string
  value: () => string
}

export function createCommandOutputCapture(maxBytes: number | null): CommandOutputCapture {
  if (maxBytes === null) {
    let output = ''
    return {
      append: chunk => {
        const text = String(chunk)
        output += text
        return text
      },
      value: () => output,
    }
  }

  let tail: Buffer = Buffer.alloc(0)
  let truncated = false
  return {
    append: chunk => {
      const bytes = toBuffer(chunk)
      const text = bytes.toString('utf8')
      if (bytes.length === 0) {
        return text
      }

      const combined = tail.length === 0 ? bytes : Buffer.concat([tail, bytes])
      if (combined.length > maxBytes) {
        truncated = true
        // Copy the retained bytes: a subarray would keep an arbitrarily large chunk alive.
        tail = Buffer.from(
          trimLeadingUtf8ContinuationBytes(combined.subarray(combined.length - maxBytes)),
        )
      } else {
        tail = combined
      }
      return text
    },
    value: () => `${truncated ? TRUNCATION_NOTICE : ''}${tail.toString('utf8')}`,
  }
}
