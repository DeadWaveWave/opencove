const PRINTABLE_ASCII = /^[\x20-\x7e]*$/
const PRINTABLE_RUN = /[\x20-\x7e]+/y
import {
  ParserAction as Action,
  ParserState as State,
  VT500_TRANSITION_TABLE,
} from './VT500Transitions'

/** Synchronous mode projection of the pinned xterm VT500 parser, before replay truncation. */
export class BracketedPasteIngressTracker {
  private enabled = false
  private readonly listeners = new Set<() => void>()
  private state = State.GROUND
  private interim = 0
  private collect = 0
  private params = [0]
  private sub = false
  private rejectDigits = false
  watermark = 0
  get bracketedPaste(): boolean {
    return this.enabled
  }
  set bracketedPaste(value: boolean) {
    const lost = this.enabled && !value
    this.enabled = value
    if (lost) {
      for (const listener of [...this.listeners]) {
        listener()
      }
    }
  }
  watchInvalidation(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private clear(): void {
    this.collect = 0
    this.params = [0]
    this.sub = false
    this.rejectDigits = false
  }
  reset(): void {
    this.bracketedPaste = false
    this.watermark = 0
    this.state = State.GROUND
    this.interim = 0
    this.clear()
  }
  /** Match xterm StringToUtf32 streaming surrogate and BOM handling before VT dispatch. */
  private *decode(data: string): Generator<number> {
    if (!data.length) {
      return
    }
    let start = 0
    if (this.interim) {
      const second = data.charCodeAt(start++)
      if (second >= 0xdc00 && second <= 0xdfff) {
        yield (this.interim - 0xd800) * 0x400 + second - 0xdc00 + 0x10000
      } else {
        yield this.interim
        yield second
      }
      this.interim = 0
    }
    for (let i = start; i < data.length; i++) {
      const code = data.charCodeAt(i)
      if (this.state === State.GROUND && code >= 0x20 && code <= 0x7e) {
        PRINTABLE_RUN.lastIndex = i
        PRINTABLE_RUN.test(data)
        i = PRINTABLE_RUN.lastIndex - 1
        continue
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        if (++i >= data.length) {
          this.interim = code
          return
        }
        const second = data.charCodeAt(i)
        if (second >= 0xdc00 && second <= 0xdfff) {
          yield (code - 0xd800) * 0x400 + second - 0xdc00 + 0x10000
        } else {
          yield code
          yield second
        }
      } else if (code !== 0xfeff) {
        yield code
      }
    }
  }
  feed(data: string): void {
    if (this.state === State.GROUND && !this.interim && PRINTABLE_ASCII.test(data)) {
      this.watermark += data.length
      return
    }
    this.watermark += Buffer.byteLength(data, 'utf8')
    for (const code of this.decode(data)) {
      const transition = VT500_TRANSITION_TABLE.table[(this.state << 8) | Math.min(code, 0xa0)]
      const action = transition >> 4
      let next = transition & 15
      switch (action) {
        case Action.CLEAR:
          this.clear()
          break
        case Action.COLLECT:
          this.collect = (this.collect << 8) | code
          break
        case Action.PARAM:
          if (code === 59) {
            this.sub = false
            if (this.params.length < 32) {
              this.params.push(0)
            } else {
              this.rejectDigits = true
            }
          } else if (code === 58) {
            this.sub = true
          } else if (!this.sub && !this.rejectDigits) {
            const last = this.params.length - 1
            this.params[last] = Math.min(0x7fffffff, this.params[last] * 10 + code - 48)
          }
          break
        case Action.CSI_DISPATCH:
          if (this.collect === 63 && (code === 104 || code === 108) && this.params.includes(2004)) {
            this.bracketedPaste = code === 104
          }
          if (this.collect === 33 && code === 112) {
            this.bracketedPaste = false
          }
          break
        case Action.ESC_DISPATCH:
          if (this.collect === 0 && code === 99) {
            this.bracketedPaste = false
          }
          break
        case Action.OSC_END:
        case Action.DCS_UNHOOK:
          if (code === 27) {
            next = State.ESCAPE
          }
          this.clear()
          break
      }
      this.state = next
    }
  }
}
