// Artificial provider: startup identifies the session without submitting a prompt.
import assert from 'node:assert/strict'
import { appendFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import {
  reportInjectedTerminalSessionStart,
  reportInjectedTerminalTurnStarted,
  reportInjectedTerminalTurnCompleted,
} from '../../../scripts/test-agent-session-stub/terminalShimHook.mjs'

const [provider, cwd, mode, , id] = process.argv.slice(2)
assert.equal(process.env.NODE_ENV, 'test')
assert.equal(process.env.OPENCOVE_TEST_USE_REAL_AGENTS, '0')
assert.equal(mode, 'resume')
const file =
  provider === 'claude-code'
    ? path.join(
        homedir(),
        '.claude',
        'projects',
        path.resolve(cwd).replace(/[^A-Za-z0-9]/gu, '-'),
        `${id}.jsonl`,
      )
    : path.join(homedir(), '.codex', 'sessions', '2026', '01', '01', `rollout-${id}.jsonl`)
assert.ok((await readFile(file, 'utf8')).includes(id))
await reportInjectedTerminalSessionStart(provider, cwd, file)
process.stdout.write('STARTUP_HISTORY_READY\n')
const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  if (!line.trim()) {
    continue
  }
  await reportInjectedTerminalTurnStarted(provider, cwd, file)
  const records =
    provider === 'claude-code'
      ? [
          { type: 'user', sessionId: id, message: { content: line } },
          {
            type: 'assistant',
            sessionId: id,
            message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
          },
        ]
      : [
          { type: 'event_msg', payload: { type: 'task_started', turn_id: line } },
          { type: 'event_msg', payload: { type: 'task_complete', turn_id: line } },
        ]
  await appendFile(file, records.map(record => JSON.stringify(record)).join('\n') + '\n')
  await reportInjectedTerminalTurnCompleted(provider, cwd, file)
  process.stdout.write('LIVE_TURN_COMPLETED\n')
}
