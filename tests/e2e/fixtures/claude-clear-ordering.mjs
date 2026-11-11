import assert from 'node:assert/strict'
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
const [provider, cwd, , , initialId] = process.argv.slice(2)
assert.equal(provider, 'claude-code')
assert.equal(process.env.NODE_ENV, 'test')
const directory = join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'ordering')
await mkdir(directory, { recursive: true })
let clock = Date.now(),
  current = initialId
const log = record => appendFile(process.env.OPENCOVE_TEST_CLEAR_LOG, JSON.stringify(record) + '\n')
async function hook(name, id, at, extra = {}) {
  const response = await fetch(process.env.OPENCOVE_CLAUDE_HOOK_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-opencove-hook-token': process.env.OPENCOVE_CLAUDE_HOOK_TOKEN,
      'x-opencove-hook-emitted-at': String(at),
    },
    body: JSON.stringify({
      session_id: id,
      cwd,
      transcript_path: join(directory, `${id}.jsonl`),
      hook_event_name: name,
      ...extra,
    }),
  })
  assert.equal(response.ok, true)
}
async function transcript(id, promptId) {
  const uuid = randomUUID()
  await writeFile(
    join(directory, `${id}.jsonl`),
    [
      {
        type: 'user',
        uuid,
        parentUuid: null,
        sessionId: id,
        promptId,
        isSidechain: false,
        promptSource: 'typed',
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'Ordering fixture' },
      },
      {
        type: 'assistant',
        uuid: randomUUID(),
        sessionId: id,
        parentUuid: uuid,
        message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ORDERED_REPLY' }] },
      },
    ]
      .map(record => JSON.stringify(record))
      .join('\n') + '\n',
  )
}
await hook('SessionStart', current, clock++, { source: 'startup' })
await log({ ready: true, id: current })
const input = createInterface({ input: process.stdin })
for await (const command of input) {
  const scenario = command.trim()
  if (
    !['reverse', 'stop-before-start', 'same-id', 'late-old', 'held-transcript'].includes(scenario)
  ) {
    continue
  }
  const old = current,
    next = randomUUID(),
    promptId = randomUUID()
  clock = Math.max(clock + 10, Date.now())
  const startAt = clock++,
    submitAt = clock++,
    stopAt = clock++
  if (scenario !== 'held-transcript') {
    await transcript(next, promptId)
  }
  if (scenario === 'stop-before-start') {
    await hook('UserPromptSubmit', next, submitAt, { prompt_id: promptId, prompt: scenario })
    await hook('Stop', next, stopAt, {
      prompt_id: promptId,
      last_assistant_message: 'ORDERED_REPLY',
    })
    await hook('SessionStart', next, startAt, { source: 'clear' })
  } else {
    await hook('SessionStart', next, startAt, { source: 'clear' })
    await hook('SessionEnd', old, clock++)
    if (scenario === 'same-id') {
      await hook('SessionStart', next, clock++, { source: 'clear' })
    }
    await hook('UserPromptSubmit', next, clock++, { prompt_id: promptId, prompt: scenario })
    await hook('Stop', next, clock++, {
      prompt_id: promptId,
      last_assistant_message: 'ORDERED_REPLY',
    })
    if (scenario === 'held-transcript') {
      await delay(500)
      await transcript(next, promptId)
    }
    if (scenario === 'late-old') {
      await hook('SessionStart', old, clock++, { source: 'clear' })
      await hook('Stop', old, clock++, { prompt_id: 'old-prompt' })
    }
  }
  current = next
  await log({ scenario, id: next })
}
