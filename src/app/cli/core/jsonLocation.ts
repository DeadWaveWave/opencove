// V8 omits offsets for some syntax errors. Locate those errors without constructing values.
export function jsonErrorOffset(source: string): number {
  let offset = 0
  const fail = (): never => {
    throw offset
  }
  const whitespace = () => {
    while (/[\t\n\r ]/.test(source[offset] ?? '\0')) {
      offset++
    }
  }
  const string = () => {
    if (source[offset] !== '"') {
      fail()
    }
    offset++
    while (offset < source.length) {
      const char = source[offset++]
      if (char === '"') {
        return
      }
      if (char.charCodeAt(0) < 32) {
        offset--
        fail()
      }
      if (char === '\\') {
        const escape = source[offset++]
        if (escape === 'u') {
          for (let i = 0; i < 4; i++) {
            if (!/[0-9a-fA-F]/.test(source[offset] ?? 'x')) {
              fail()
            }
            offset++
          }
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) {
          offset--
          fail()
        }
      }
    }
    fail()
  }
  const value = () => {
    whitespace()
    const char = source[offset]
    if (char === '"') {
      string()
      return
    }
    if (char === '{' || char === '[') {
      const close = char === '{' ? '}' : ']'
      offset++
      whitespace()
      if (source[offset] === close) {
        offset++
        return
      }
      while (true) {
        if (char === '{') {
          string()
          whitespace()
          if (source[offset] !== ':') {
            fail()
          }
          offset++
        }
        value()
        whitespace()
        if (source[offset] === close) {
          offset++
          return
        }
        if (source[offset] !== ',') {
          fail()
        }
        offset++
        whitespace()
      }
    }
    const keyword = char === 't' ? 'true' : char === 'f' ? 'false' : char === 'n' ? 'null' : ''
    if (keyword) {
      for (const expected of keyword) {
        if (source[offset] !== expected) {
          fail()
        }
        offset++
      }
      return
    }
    const literal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(offset))
    if (!literal) {
      fail()
    }
    offset += literal![0].length
  }
  try {
    value()
    whitespace()
    if (offset !== source.length) {
      fail()
    }
  } catch {
    // Also bound the location if pathological nesting exhausts the stack.
  }
  return Math.min(offset, source.length)
}
