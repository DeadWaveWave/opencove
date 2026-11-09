export async function runTerminalStateRestoreScenario() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }
  process.stdin.setEncoding('utf8')
  process.stdin.resume()
  process.stdout.write('STATE_NORMAL_BEHIND\r\n')
  process.stdout.write(
    '\x1b[?1049h\x1b[2J\x1b[H' +
      '\x1b[?2004h\x1b[?1003h\x1b[?1006h\x1b[?1h\x1b[?66h\x1b[?1004h\x1b[?25l' +
      Array.from({ length: 8 }, (_, i) => `STATE_HISTORY_${String(i + 1).padStart(2, '0')}`).join(
        '\r\n',
      ),
  )
  let tick = 0
  const timer = setInterval(() => {
    // Modes are set ONCE. A later repaint must not repair a broken restore for the test.
    process.stdout.write(`\x1b[10;1H\r\x1b[2KSTATE_STATUS_${++tick}`)
  }, 60)
  let pending = ''
  const input = chunk => {
    pending = (pending + chunk).slice(-16_000)
    const start = pending.indexOf('\x1b[200~')
    const end = pending.indexOf('\x1b[201~', start)
    if (start >= 0 && end >= 0) {
      const bytes = pending.slice(start, end + 6)
      process.stdout.write(`\x1b[12;1H\x1b[2KSTATE_PASTE ${JSON.stringify(bytes)}`)
      pending = pending.slice(end + 6)
    } else if (start < 0 && /[\r\n]/u.test(pending)) {
      process.stdout.write(`\x1b[12;1H\x1b[2KSTATE_UNBRACKETED ${JSON.stringify(pending)}`)
      pending = ''
    }
  }
  process.stdin.on('data', input)
  await new Promise(resolve => {
    let finished = false
    const finish = () => {
      if (finished) {
        return
      }
      finished = true
      clearInterval(timer)
      process.off('SIGTERM', finish)
      process.off('SIGINT', finish)
      process.stdin.off('end', finish)
      process.stdin.off('data', input)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      process.stdin.pause()
      resolve()
    }
    process.once('SIGTERM', finish)
    process.once('SIGINT', finish)
    process.stdin.once('end', finish)
  })
}
