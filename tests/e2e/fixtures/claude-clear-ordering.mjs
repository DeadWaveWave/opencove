import assert from 'node:assert/strict'
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
const [provider, cwd, mode, , initialId] = process.argv.slice(2)
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
await log({ ready: true, id: current, mode, cwd })
process.stdout.write('\x1b[?2004h')
process.stdin.setRawMode?.(true)
let pending = '',
  clearOnPaste = false,
  pastes = 0,
  enters = 0,
  pasteCounted = false,
  swallowInput = false
let serial = Promise.resolve()
async function commandReceived(command) {
  const scenario = command.trim()
  if (!scenario) {
    enters++
    return
  }
  if (scenario === 'input-counts') {
    await log({ scenario, id: current, pastes, enters })
    return
  }
  if (
    [
      'clear-input',
      'clear-after-paste',
      'delayed-input',
      'unreported-dialog',
      'slash-menu',
      'pending-output',
      'waiting-input',
    ].includes(scenario)
  ) {
    const old = current
    current = randomUUID()
    clock = Math.max(clock + 10, Date.now())
    const startAt = clock++,
      submitAt = clock++
    if (scenario === 'delayed-input') {
      await hook('UserPromptSubmit', current, submitAt, { prompt_id: 'early', prompt: 'early' })
      await log({ scenario: 'quarantined', id: current })
      await delay(1000)
    }
    await hook('SessionStart', current, startAt, { source: 'clear' })
    await hook('Stop', old, clock++, { prompt_id: 'late-A', last_assistant_message: 'OLD' })
    clearOnPaste = scenario === 'clear-after-paste'
    swallowInput = ['unreported-dialog', 'slash-menu', 'pending-output'].includes(scenario)
    if (scenario === 'pending-output') {
      process.stdout.write('Background output after clear\r\n')
    }
    if (scenario === 'waiting-input') {
      await hook('PermissionRequest', current, clock++, { tool_name: 'Bash' })
    }
    await log({ scenario, id: current })
    return
  }
  if (scenario.startsWith('\x1b[200~')) {
    enters++
    if (swallowInput) {
      await log({ scenario: 'consumed-input', id: current, pastes, enters })
      return
    }
    const text = scenario.slice(6).replace('\x1b[201~', '')
    const promptId = randomUUID()
    clock = Math.max(clock + 10, Date.now())
    await hook('UserPromptSubmit', current, clock++, { prompt_id: promptId, prompt: text })
    await transcript(current, promptId)
    await hook('Stop', current, clock++, {
      prompt_id: promptId,
      last_assistant_message: 'ORDERED_REPLY',
    })
    await log({ scenario: 'submitted-input', id: current, text, pastes, enters })
    return
  }
  if (
    !['reverse', 'stop-before-start', 'same-id', 'late-old', 'held-transcript'].includes(scenario)
  ) {
    return
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

process.stdin.on('data', chunk => {
  const text = chunk.toString()
  serial = serial
    .then(async () => {
      pending += text
      if (!pasteCounted && pending.includes('\x1b[200~') && pending.includes('\x1b[201~')) {
        pastes++
        pasteCounted = true
        if (clearOnPaste) {
          clearOnPaste = false
          current = randomUUID()
          clock = Math.max(clock + 10, Date.now())
          await hook('SessionStart', current, clock++, { source: 'clear' })
          await log({ scenario: 'cleared-after-paste', id: current, pastes, enters })
          pending = ''
          pasteCounted = false
        }
      }
      let end
      while ((end = pending.search(/[\r\n]/)) >= 0) {
        const command = pending.slice(0, end)
        pending = pending.slice(end + 1)
        pasteCounted = false
        // oxlint-disable-next-line no-await-in-loop -- serial PTY commands share one editor
        await commandReceived(command)
      }
    })
    .catch(error => {
      process.stderr.write(String(error))
      process.exitCode = 1
      process.stdin.destroy()
    })
})
