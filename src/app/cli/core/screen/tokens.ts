export type ScreenToken =
  | { type: 'text' | 'control'; value: string }
  | { type: 'csi'; params: string; final: string }

/** Consume complete control strings, including unsupported ones, without leaking payload text. */
export function* screenTokens(text: string): Generator<ScreenToken> {
  let i = 0
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (code === 0x1b || (code >= 0x80 && code <= 0x9f)) {
      const introducer = code === 0x1b ? text[++i] : String.fromCharCode(code - 0x40)
      i++
      if (introducer === '[') {
        const start = i
        while (i < text.length && text.charCodeAt(i) >= 0x20 && text.charCodeAt(i) <= 0x3f) {
          i++
        }
        if (i < text.length && text.charCodeAt(i) >= 0x40 && text.charCodeAt(i) <= 0x7e) {
          yield { type: 'csi', params: text.slice(start, i), final: text[i++] }
        }
      } else if ([']', 'P', '_', '^', 'X'].includes(introducer)) {
        while (i < text.length) {
          if (text.charCodeAt(i) === 0x9c || (introducer === ']' && text.charCodeAt(i) === 7)) {
            i++
            break
          }
          if (text[i] === '\x1b' && text[i + 1] === '\\') {
            i += 2
            break
          }
          i++
        }
      } else if (code === 0x1b) {
        // ESC intermediates (for example charset selection ESC ( 0) plus their final byte.
        while (
          i < text.length &&
          text.charCodeAt(i - 1) >= 0x20 &&
          text.charCodeAt(i - 1) <= 0x2f
        ) {
          i++
        }
      }
      continue
    }
    if (code < 0x20 || code === 0x7f) {
      yield { type: 'control', value: text[i++] }
      continue
    }
    const start = i++
    while (i < text.length) {
      const next = text.charCodeAt(i)
      if (next < 0x20 || (next >= 0x7f && next <= 0x9f)) {
        break
      }
      i++
    }
    yield { type: 'text', value: text.slice(start, i) }
  }
}
