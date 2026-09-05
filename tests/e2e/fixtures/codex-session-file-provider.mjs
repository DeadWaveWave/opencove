import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('app-server') || args.includes('--config')) {
  throw new Error('Unexpected Codex hook preflight or injection')
}
appendFileSync(process.env.OPENCOVE_SESSION_FILE_FIXTURE_LOG, JSON.stringify(args) + '\n')
const resumeIndex = args.indexOf('resume')
const id = resumeIndex >= 0 ? args[resumeIndex + 1] : randomUUID()
const root = join(process.env.CODEX_HOME, 'sessions')
mkdirSync(root, { recursive: true })
const existing = readdirSync(root, { recursive: true }).find(file => file.endsWith(`-${id}.jsonl`))
const now = new Date()
const directory = join(
  root,
  String(now.getFullYear()),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
)
mkdirSync(directory, { recursive: true })
const file = existing ? join(root, existing) : join(directory, `rollout-${id}.jsonl`)
if (resumeIndex >= 0 && !existsSync(file)) {
  throw new Error('Exact resume file missing')
}
if (!existing) {
  writeFileSync(
    file,
    JSON.stringify({
      type: 'session_meta',
      timestamp: now.toISOString(),
      payload: { id, cwd: process.cwd(), timestamp: now.toISOString(), source: 'cli' },
    }) + '\n',
  )
} else {
  const history = readFileSync(file, 'utf8')
  process.stdout.write('RESTORED_HISTORY=' + history + '\r\n')
  for (const line of history.trim().split('\n')) {
    const message = JSON.parse(line).payload?.last_agent_message
    if (message) {
      process.stdout.write('RESTORED_TURN=' + message + '\r\n')
    }
  }
}
process.stdin.setRawMode(true)
process.stdin.resume()
let input = ''
process.stdin.on('data', chunk => {
  for (const byte of chunk) {
    if (byte === 3) {
      process.exit(0)
    }
    if (byte === 13) {
      const text = input
      input = ''
      appendFileSync(
        file,
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }) + '\n',
      )
      setTimeout(() => {
        appendFileSync(
          file,
          JSON.stringify({
            type: 'event_msg',
            payload: { type: 'task_complete', last_agent_message: text },
          }) + '\n',
        )
        process.stdout.write('SAVED_TURN=' + text + '\r\n')
      }, 800)
    } else if (byte >= 32) {
      input += String.fromCharCode(byte)
    }
  }
})
process.stdout.write('CODEX_FILE_READY=' + id + '\r\n')
