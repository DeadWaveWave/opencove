// Observation only: invoked before the shell execs the real CLI, or as an extra Claude hook.
import { appendFileSync, readFileSync } from 'node:fs'

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
