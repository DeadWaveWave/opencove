import { sleep } from './sleep.mjs'

const STDIN_ECHO_SCENARIO_LIFETIME_MS = 180_000

function bufferToHex(buffer) {
  if (!buffer || buffer.length === 0) {
    return ''
  }

  return Buffer.from(buffer).toString('hex')
}

export async function runStdinEchoScenario() {
  process.stdout.write('[opencove-test-agent] stdin-echo ready\n')

  process.stdin.on('data', chunk => {
    const hex = bufferToHex(chunk)
    if (hex.length === 0) {
      return
    }

    process.stdout.write(`[opencove-test-agent] stdin_hex=${hex}\n`)
  })

  // Keep alive long enough for E2E to send a few keystrokes.
  await sleep(STDIN_ECHO_SCENARIO_LIFETIME_MS)
}
