// Deterministic Pi API fixture, NOT a real Pi CLI or real-model parity test.
// Executes the exact launch-injected OpenCove extension rather than posting fabricated hooks.
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

if (process.argv.includes('--version')) {
  process.stdout.write('pi-fixture 0.84.4\n')
  process.exit(0)
}
const args = process.argv.slice(2)
const extension = args[args.indexOf('-e') + 1]
if (!args.includes('-e')) {
  throw new Error('Pi fixture requires launch-scoped extension injection')
}
const source = await readFile(extension, 'utf8')
let handlers = new Map()
let idle = true
let id = randomUUID()
let file = join(process.env.OPENCOVE_TEST_PI_SESSION_DIR, `${id}.jsonl`)
let restoredReply = null
if (args.includes('--session')) {
  file = args[args.indexOf('--session') + 1]
  const entries = (await readFile(file, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  if (entries[0]?.type !== 'session' || entries[0]?.version !== 3) {
    throw new Error('Pi fixture requires a version 3 session header')
  }
  id = entries[0].id
  const lastAssistant = entries.findLast(
    entry => entry.type === 'message' && entry.message?.role === 'assistant',
  )
  restoredReply = lastAssistant?.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}
let reload = 0
const ctx = {
  isIdle: () => idle,
  hasPendingMessages: () => false,
  sessionManager: { getSessionId: () => id, getSessionFile: () => file },
}
async function emit(name, event = {}) {
  await handlers.get(name)?.(event, ctx)
}
async function load(reason) {
  handlers = new Map()
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(source + `\n// instance ${++reload}`).toString('base64')}`
  )
  module.default({ on: (name, handler) => handlers.set(name, handler) })
  await emit('session_start', { reason })
  process.stdout.write(`[pi-fixture] ready ${reason}\n`)
  if (restoredReply) {
    process.stdout.write(`[pi-fixture] restored ${id}\n${restoredReply}\n`)
  }
}
await load('startup')
const input = createInterface({ input: process.stdin })
for await (const line of input) {
  if (line === '/working') {
    idle = false
    await emit('agent_start')
  }
  if (line === '/wait') {
    await emit('ui_prompt_start')
  }
  if (line === '/answer') {
    await emit('ui_prompt_end')
  }
  if (line === '/done') {
    await writeFile(
      file,
      [
        {
          type: 'session',
          version: 3,
          id,
          cwd: process.cwd(),
          timestamp: new Date().toISOString(),
        },
        {
          type: 'message',
          id: 'reply',
          parentId: null,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Fixture reply' }],
            stopReason: 'stop',
          },
        },
      ]
        .map(row => JSON.stringify(row))
        .join('\n') + '\n',
    )
    await emit('agent_end')
    idle = true
    await emit('agent_settled')
  }
  if (line === '/reload' || line === '/new') {
    const reason = line.slice(1)
    await emit('session_shutdown', { reason })
    if (reason === 'new') {
      id = randomUUID()
      file = join(process.env.OPENCOVE_TEST_PI_SESSION_DIR, `${id}.jsonl`)
      restoredReply = null
    }
    await load(reason)
  }
  if (line === '/quit') {
    break
  }
}
await emit('session_shutdown', { reason: 'quit' })
input.close()
