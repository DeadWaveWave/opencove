import { writeFile } from 'node:fs/promises'

const INTERRUPT_BYTE = 0x03

export async function runTwoStageCtrlCFixture(provider) {
  const pidPath = process.env.OPENCOVE_TEST_TWO_STAGE_PROVIDER_PID_PATH
  if (pidPath) {
    await writeFile(pidPath, String(process.pid), 'utf8')
  }
  process.stdout.write(`\u001b[?1049h[opencove-test-2c] ${provider} ready\n`)

  await new Promise(resolve => {
    let interruptCount = 0
    let settled = false
    const cleanup = () => {
      process.stdin.off('data', handleData)
      process.off('SIGINT', handleInterrupt)
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false)
      }
      process.stdin.pause()
    }
    const handleInterrupt = () => {
      if (settled) {
        return
      }
      interruptCount += 1
      if (interruptCount === 1) {
        process.stdout.write(`\u001b[?1049l[opencove-test-2c] ${provider} cancel-alt-exit\n`)
        return
      }

      settled = true
      cleanup()
      process.stdout.write(`[opencove-test-2c] ${provider} provider-exit\n`)
      resolve()
    }
    const handleData = chunk => {
      for (const byte of Buffer.from(chunk)) {
        if (byte === INTERRUPT_BYTE) {
          handleInterrupt()
        }
      }
    }

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true)
    }
    process.stdin.on('data', handleData)
    process.stdin.resume()
    process.on('SIGINT', handleInterrupt)
  })
}
