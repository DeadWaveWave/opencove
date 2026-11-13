// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { runInitialPromptArgvScenario } from '../../../scripts/test-agent-session-stub/initialPromptArgv.mjs'
import { buildAgentLaunchCommand } from '../../../src/contexts/agent/infrastructure/cli/AgentCommandFactory'

vi.mock('../../../scripts/test-agent-session-stub/sleep.mjs', () => ({ sleep: async () => {} }))

const notify = 'notify=["/usr/bin/env","ELECTRON_RUN_AS_NODE=1","/fixture/space dir/relay.mjs"]'
const planFor = (prompt: string) =>
  buildAgentLaunchCommand({
    provider: 'codex',
    mode: 'new',
    prompt,
    model: 'chosen',
    resumeSessionId: null,
    agentFullAccess: false,
    injectedArgs: ['--config', notify],
  })

it('records the actual Codex hook configuration as a value and keeps the launch prompt literal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-prompt-receiver-'))
  try {
    const prompt = '--model=other\n中文 "quotes" $value `literal`'
    const plan = planFor(prompt)
    await runInitialPromptArgvScenario(root, 'codex', plan.args)
    const received = JSON.parse(await readFile(join(root, 'initial-prompt-argv.jsonl'), 'utf8'))
    expect(received).toMatchObject({
      provider: 'codex',
      args: plan.args,
      prompt,
      values: { '--config': [notify], '--model': 'chosen', '--sandbox': 'workspace-write' },
    })
    expect(received.command).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('retains receiver command detection when a negative control removes the delimiter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-prompt-receiver-'))
  try {
    const plan = planFor('resume')
    await runInitialPromptArgvScenario(root, 'codex', plan.args)
    await runInitialPromptArgvScenario(
      root,
      'codex',
      plan.args.filter(arg => arg !== '--'),
    )
    const [accepted, unsafe] = (await readFile(join(root, 'initial-prompt-argv.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(accepted).toMatchObject({ prompt: 'resume' })
    expect(accepted.command).toBeUndefined()
    expect(unsafe.command).toBe('resume')
    expect(unsafe.prompt).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
