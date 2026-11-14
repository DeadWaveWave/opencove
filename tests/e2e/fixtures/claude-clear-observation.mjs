// Observation only: invoked before the shell execs the real CLI, or as an extra Claude hook.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const [kind, logPath, ...argv] = process.argv.slice(2)
const record = { kind, at: new Date().toISOString(), cwd: process.cwd() }
if (kind === 'invocation') {
  // The shell's exec keeps this PID and passes these exact arguments to the real Claude CLI.
  Object.assign(record, { pid: process.ppid, argv })
} else if (kind === 'hook') {
  Object.assign(record, { input: JSON.parse(readFileSync(0, 'utf8')) })
} else {
  throw new Error(`Unknown probe record kind: ${kind}`)
}
appendFileSync(logPath, `${JSON.stringify(record)}\n`)

if (
  record.input?.hook_event_name === 'SessionStart' &&
  record.input.source === 'clear' &&
  process.env.OPENCOVE_TEST_CLEAR_HOOK_DELAY_MS
) {
  await new Promise(resolve =>
    setTimeout(resolve, Number(process.env.OPENCOVE_TEST_CLEAR_HOOK_DELAY_MS)),
  )
  writeFileSync(`${logPath}.clear-hook-complete`, '')
}
