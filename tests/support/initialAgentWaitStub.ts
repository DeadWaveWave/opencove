// The stub receives the actual launch prompt and reports through the invocation's hook channel.
// It never accepts PTY input, so an accidental second prompt cannot make these assertions pass.
export const initialAgentWaitStub = `
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
const [provider, cwd, , , , , ...args] = process.argv.slice(2)
const prompt = args.find(value => ['Initial reply', 'Permission check', 'Question check'].includes(value))
if (!prompt) throw new Error('Expected initial prompt in the real provider launch arguments')
const prefix = provider === 'codex' ? 'OPENCOVE_CODEX_HOOK' : 'OPENCOVE_CLAUDE_HOOK'
const providerSessionId = randomUUID()
const index = args.indexOf('--session-id')
const sessionId = index >= 0 ? args[index + 1] : providerSessionId
const post = async (event, fields = {}) => {
  const response = await fetch(process.env[prefix + '_ENDPOINT'], {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-opencove-hook-token': process.env[prefix + '_TOKEN'] },
    body: JSON.stringify({ session_id: sessionId, transcript_path: join(cwd, 'initial-turn.jsonl'), cwd,
      hook_event_name: event, turn_id: 'initial-provider-turn', prompt_id: 'initial-prompt', prompt,
      emittedAtMs: Date.now(), ...fields }),
  })
  if (!response.ok) throw new Error('Hook failed: ' + response.status)
}
await post('UserPromptSubmit')
if (prompt !== 'Initial reply') {
  await post('PermissionRequest', { tool_name: prompt === 'Permission check' ? 'Bash' : 'AskUserQuestion', tool_input: {
    questions: [{ question: 'Allow access?', options: [{ label: 'Allow' }, { label: 'Deny' }] }],
  } })
} else {
  await post('Stop', { last_assistant_message: 'Initial stub reply', stop_hook_active: false })
}
setInterval(() => {}, 1000)
`
