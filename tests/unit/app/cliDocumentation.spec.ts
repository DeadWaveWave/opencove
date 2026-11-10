// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ')

it('documents exact-turn coordination and the delivery nonzero-output exception', () => {
  const cli = read('docs/cli/README.md')
  expect(cli).toContain('confirm delivery')
  expect(cli).toContain('agent wait --node node-123 --turn turn-123')
  expect(cli).toContain('lastEndedTurn')
  expect(cli).toContain('memoryOnlyReason')
  expect(cli).toContain('terminals with registered agent run state')
  for (const path of [
    'docs/cli/README.md',
    'docs/cli/AGENT_PLAYBOOK.md',
    'docs/cli/AGENT_PROMPT.md',
  ]) {
    expect(read(path), path).toMatch(/agent delivery.{0,250}(?:exit|退出) ?(?:`?1|码为 1)/)
  }
})
it('documents Worker run-state ownership and current provider observations', () => {
  const agent = read('docs/agent/README.md')
  expect(agent).toContain('AgentRunStateRegistry')
  expect(agent).toContain('OpenCode uses its session status API')
  expect(agent).not.toContain('renderer arbiter')
  expect(agent).not.toContain('CLI_CANVAS_NODE_CONTROL')
  expect(read('docs/agent/RUN_STATE.md')).toContain('codex_hook')
})
