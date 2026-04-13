import { sleep } from './sleep.mjs'

const BRACKETED_PASTE_START = '\u001b[200~'
const BRACKETED_PASTE_END = '\u001b[201~'
const ENTER_ALTERNATE_SCREEN = '\u001b[?1049h'
const EXIT_ALTERNATE_SCREEN = '\u001b[?1049l'
const ENABLE_SGR_MOUSE = '\u001b[?1000h\u001b[?1006h'
const DISABLE_SGR_MOUSE = '\u001b[?1000l\u001b[?1006l'
const ENABLE_FOCUS_EVENTS = '\u001b[?1004h'
const DISABLE_FOCUS_EVENTS = '\u001b[?1004l'
const DEVICE_STATUS_REPORT = '\u001b[6n'

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

function containsMouseReport(buffer) {
  const sgrStartIndex = buffer.indexOf('\u001b[<')
  if (sgrStartIndex !== -1) {
    const sgrMatch = /^(\d+);(\d+);(\d+)([mM])/.exec(
      buffer.slice(sgrStartIndex + '\u001b[<'.length),
    )
    if (sgrMatch) {
      return true
    }
  }

  const x10Index = buffer.indexOf('\u001b[M')
  return x10Index !== -1 && buffer.length >= x10Index + 6
}

function containsDeviceStatusReply(buffer) {
  const replyStart = buffer.lastIndexOf('\u001b[')
  if (replyStart === -1) {
    return false
  }

  const payload = buffer.slice(replyStart + '\u001b['.length)
  let index = 0

  while (index < payload.length && payload[index] >= '0' && payload[index] <= '9') {
    index += 1
  }

  if (index === 0 || payload[index] !== ';') {
    return false
  }

  index += 1
  const colStart = index

  while (index < payload.length && payload[index] >= '0' && payload[index] <= '9') {
    index += 1
  }

  if (index === colStart || payload[index] !== 'R') {
    return false
  }

  return true
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

export async function runRawDsrReplyEchoScenario() {
  // xterm will reply to DSR (ESC[6n) via stdin. If the reply is delayed until after raw/noecho
  // is disabled, many PTYs will echo it back visibly (for example `^[[1;1R`). This scenario is
  // used to catch regressions where hydration/replay delays terminal replies.
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true)
  }

  process.stdout.write(DEVICE_STATUS_REPORT)

  setTimeout(() => {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false)
    }
  }, 200)

  await sleep(1200)
  process.stdout.write('[opencove-test-dsr] done\n')
  await sleep(20_000)
}

export async function runRawColorProbeScenario() {
  const runId = Date.now()
  let buffer = ''
  let sawDsrReply = false

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true)
  }

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    buffer += chunk
    if (containsDeviceStatusReply(buffer)) {
      sawDsrReply = true
    }
    if (buffer.length > 256) {
      buffer = buffer.slice(-128)
    }
  })
  process.stdin.resume()

  process.stdout.write(DEVICE_STATUS_REPORT)

  await sleep(400)

  // If the terminal replied promptly to DSR, output a colored token; otherwise output the same
  // token without ANSI colors. This mimics CLIs that disable color when terminal replies are delayed.
  const token = `COLOR_PROBE_${runId}`
  if (sawDsrReply) {
    process.stdout.write(`\u001b[31m${token}\u001b[0m\n`)
  } else {
    process.stdout.write(`${token}\n`)
  }

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(false)
  }

  process.stdout.write(`[opencove-test-color] runId=${runId} done\n`)
  await sleep(20_000)
}

export async function runRawFocusRedrawAfterFocusScenario() {
  process.stdout.write(`${ENABLE_FOCUS_EVENTS}[opencove-test-focus] ready\n`)

  await new Promise(resolveScenario => {
    let settled = false
    let focusInCount = 0

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
      process.stdout.write(`${message}${DISABLE_FOCUS_EVENTS}`)
      resolveScenario()
    }

    const handleData = chunk => {
      const focusInMatchCount = chunk.split('\u001b[I').length - 1
      if (focusInMatchCount <= 0) {
        return
      }

      focusInCount += focusInMatchCount
      if (focusInCount < 2) {
        return
      }

      process.stdout.write('\u001b[2J\u001b[H')
      setTimeout(() => {
        settle('[opencove-test-focus] redraw complete\n')
      }, 700)
    }

    const timeout = setTimeout(() => {
      settle('[opencove-test-focus] timeout\n')
    }, 12_000)

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true)
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', handleData)
    process.stdin.resume()
  })

  await sleep(20_000)
}

export async function runRawClickRedrawAfterClickScenario() {
  process.stdout.write(`${ENABLE_SGR_MOUSE}[opencove-test-click] ready\n`)

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
      process.stdout.write(`${message}${DISABLE_SGR_MOUSE}`)
      resolveScenario()
    }

    const handleData = chunk => {
      buffer += chunk
      if (!containsMouseReport(buffer)) {
        if (buffer.length > 256) {
          buffer = buffer.slice(-128)
        }
        return
      }

      process.stdout.write('\u001b[2J\u001b[H')
      setTimeout(() => {
        settle('[opencove-test-click] redraw complete\n')
      }, 700)
    }

    const timeout = setTimeout(() => {
      settle('[opencove-test-click] timeout\n')
    }, 12_000)

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true)
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', handleData)
    process.stdin.resume()
  })

  await sleep(20_000)
}
