import { sleep } from './sleep.mjs'

const BRACKETED_PASTE_START = '\u001b[200~'
const BRACKETED_PASTE_END = '\u001b[201~'
const ENTER_ALTERNATE_SCREEN = '\u001b[?1049h'
const EXIT_ALTERNATE_SCREEN = '\u001b[?1049l'
const ENABLE_SGR_MOUSE = '\u001b[?1000h\u001b[?1006h'
const DISABLE_SGR_MOUSE = '\u001b[?1000l\u001b[?1006l'

function extractBracketedPastePayload(buffer) {
  const startIndex = buffer.indexOf(BRACKETED_PASTE_START)
  if (startIndex === -1) {
    return null
  }

  const contentStartIndex = startIndex + BRACKETED_PASTE_START.length
  const endIndex = buffer.indexOf(BRACKETED_PASTE_END, contentStartIndex)
  if (endIndex === -1) {
    return null
  }

  return buffer.slice(contentStartIndex, endIndex)
}

function extractMouseWheelLabel(buffer) {
  const sgrStartIndex = buffer.indexOf('\u001b[<')
  const sgrMatch =
    sgrStartIndex === -1
      ? null
      : /^(\d+);(\d+);(\d+)([mM])/.exec(buffer.slice(sgrStartIndex + '\u001b[<'.length))
  if (sgrMatch) {
    const buttonCode = Number(sgrMatch[1])
    if (buttonCode >= 64) {
      return buttonCode % 2 === 0 ? 'wheel-up' : 'wheel-down'
    }
  }

  const x10Index = buffer.indexOf('\u001b[M')
  if (x10Index === -1 || buffer.length < x10Index + 6) {
    return null
  }

  const buttonCode = buffer.charCodeAt(x10Index + 3) - 32
  if (buttonCode < 64) {
    return null
  }

  return buttonCode % 2 === 0 ? 'wheel-up' : 'wheel-down'
}

function extractX10MouseReportBytes(buffer) {
  const x10Index = buffer.indexOf('\u001b[M')
  if (x10Index === -1 || buffer.length < x10Index + 6) {
    return null
  }
  const report = buffer.slice(x10Index, x10Index + 6)
  return Array.from(report, char => char.charCodeAt(0))
}

export async function runRawBracketedPasteEchoScenario() {
  process.stdout.write('\u001b[?2004h')

  await new Promise(resolveScenario => {
    let settled = false
    let buffer = ''

    const settle = message => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      process.stdout.write(`${message}\n`)
      process.stdout.write('\u001b[?2004l')
      resolveScenario()
    }

    const timeout = setTimeout(() => {
      settle('[opencove-test-paste] timeout')
    }, 8_000)

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true)
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buffer += chunk

      const bracketedPayload = extractBracketedPastePayload(buffer)
      if (typeof bracketedPayload === 'string') {
        settle(`[opencove-test-paste] ${bracketedPayload}`)
        return
      }

      if (buffer.includes('\u0016')) {
        settle('[opencove-test-paste] ctrl-v')
      }
    })
    process.stdin.resume()
  })

  await sleep(20_000)
}

export async function runRawAltScreenWheelEchoScenario() {
  process.stdout.write(`${ENTER_ALTERNATE_SCREEN}${ENABLE_SGR_MOUSE}`)

  for (let index = 1; index <= 90; index += 1) {
    process.stdout.write(`ALT_SCREEN_ROW_${String(index).padStart(3, '0')}\n`)
  }
  process.stdout.write('ALT_SCREEN_WHEEL_READY\n')

  await new Promise(resolveScenario => {
    let settled = false
    let buffer = ''

    const cleanup = () => {
      process.stdin.off('data', handleData)
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false)
      }
    }

    const settle = message => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      cleanup()
      process.stdout.write(`${DISABLE_SGR_MOUSE}${EXIT_ALTERNATE_SCREEN}${message}\n`)
      resolveScenario()
    }

    const handleData = chunk => {
      buffer += chunk
      const wheelLabel = extractMouseWheelLabel(buffer)
      if (wheelLabel) {
        const x10Codes = extractX10MouseReportBytes(buffer)
        const codeSuffix = Array.isArray(x10Codes) ? ` codes=${x10Codes.join(',')}` : ''
        settle(`[opencove-test-wheel] ${wheelLabel}${codeSuffix}`)
      }
    }

    const timeout = setTimeout(() => {
      settle('[opencove-test-wheel] timeout')
    }, 8_000)

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true)
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', handleData)
    process.stdin.resume()
  })

  await sleep(20_000)
}
