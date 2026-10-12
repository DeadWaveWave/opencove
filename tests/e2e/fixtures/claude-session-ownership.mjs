// Artificial provider for the managed-session ownership regression. No model or real CLI calls.
import assert from 'node:assert/strict'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  reportInjectedTerminalSessionStart,
  reportInjectedTerminalTurnCompleted,
} from '../../../scripts/test-agent-session-stub/terminalShimHook.mjs'

const [provider, cwd, mode, , sessionId] = process.argv.slice(2)
assert.equal(process.env.NODE_ENV, 'test')
assert.equal(process.env.OPENCOVE_TEST_USE_REAL_AGENTS, '0')
assert.equal(provider, 'claude-code')
assert.match(
  sessionId ?? '',
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
)
assert.equal(homedir(), process.env.HOME)
assert.equal(process.env.CLAUDE_CONFIG_DIR, path.join(homedir(), '.claude'))
assert.equal(cwd, process.env.OPENCOVE_TEST_WORKSPACE)
assert.ok(process.env.OPENCOVE_CLAUDE_HOOK_ENDPOINT)
assert.ok(process.env.OPENCOVE_CLAUDE_HOOK_TOKEN)

const projectDirectory = path.join(
  homedir(),
  '.claude',
  'projects',
  path.resolve(cwd).replace(/[^A-Za-z0-9]/gu, '-'),
)
const transcriptPath = path.join(projectDirectory, `${sessionId}.jsonl`)
await mkdir(projectDirectory, { recursive: true })
if (mode === 'resume') {
  // A guessed ID must not silently create a new transcript and make recovery appear successful.
  const existing = await readFile(transcriptPath, 'utf8')
  assert.ok(existing.includes(`"sessionId":"${sessionId}"`))
}
await appendFile(
  transcriptPath,
  `${JSON.stringify({
    type: 'assistant',
    sessionId,
    cwd,
    timestamp: new Date().toISOString(),
    message: {
      content: [{ type: 'text', text: `Artificial ownership fixture ${sessionId}` }],
      stop_reason: 'end_turn',
    },
  })}\n`,
)
await reportInjectedTerminalSessionStart(provider, cwd, transcriptPath)
await reportInjectedTerminalTurnCompleted(provider, cwd, transcriptPath)
await appendFile(
  process.env.OPENCOVE_TEST_CLAUDE_OWNERSHIP_LOG,
  `${JSON.stringify({ mode, sessionId, cwd, pid: process.pid })}\n`,
)
process.stdout.write(`[opencove-test-claude-ownership] ${mode}\n${sessionId}\n`)
process.stdin.resume()
