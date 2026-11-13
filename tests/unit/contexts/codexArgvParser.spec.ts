// @vitest-environment node
import { expect, it } from 'vitest'
import { parseCodex } from '../../fixtures/provider-argv/stringOptions.mjs'
import { buildAgentLaunchCommand } from '../../../src/contexts/agent/infrastructure/cli/AgentCommandFactory'

const notify = 'notify=["/usr/bin/env","ELECTRON_RUN_AS_NODE=1","/fixture/space dir/relay.mjs"]'
const prompt = '--model=other\n中文 "quoted"; $value `literal`'

it('consumes the production Codex hook configuration before parsing the initial prompt', () => {
  const plan = buildAgentLaunchCommand({
    provider: 'codex',
    mode: 'new',
    prompt,
    model: 'chosen',
    resumeSessionId: null,
    agentFullAccess: false,
    injectedArgs: ['--config', notify],
  })
  expect(parseCodex(plan.args)).toMatchObject({
    command: undefined,
    prompt,
    values: {
      '--config': [notify],
      '--model': 'chosen',
      '--sandbox': 'workspace-write',
      '--ask-for-approval': 'on-request',
    },
  })
})
it.each([
  ['--config', notify],
  ['-c', notify],
  [`--config=${notify}`],
  [`-c=${notify}`],
  [`-c${notify}`],
])('consumes config value without command dispatch: %j', (...args) => {
  expect(parseCodex([...args, '--', prompt])).toMatchObject({
    command: undefined,
    prompt,
    values: { '--config': [notify] },
  })
})
it('appends repeated short and long config values without rewriting their text', () => {
  const values = [notify, 'model="chosen"', 'hooks={name="中文", command="a=b"}']
  expect(
    parseCodex(['-c', values[0], '--config', values[1], `--config=${values[2]}`, '--', prompt]),
  ).toMatchObject({ command: undefined, prompt, values: { '--config': values } })
})
it('keeps command names literal while a config value is pending, and preserves command detection afterward', () => {
  expect(parseCodex(['--config', 'resume', '--', prompt])).toMatchObject({
    command: undefined,
    prompt,
    values: { '--config': ['resume'] },
  })
  expect(parseCodex(['--config', notify, 'resume']).command).toBe('resume')
  expect(parseCodex(['resume']).command).toBe('resume')
})
it.each(['-', '', 'notify=["中文", "a=b"]', '--help'])(
  'keeps attached config text literal: %j',
  config => {
    expect(parseCodex([`--config=${config}`, '--', prompt])).toMatchObject({
      command: undefined,
      prompt,
      values: { '--config': [config] },
    })
  },
)
it('keeps a lone dash as a separated config value, and does not consume options past --', () => {
  expect(parseCodex(['-c', '-', '--', prompt]).values['--config']).toEqual(['-'])
  expect(parseCodex(['--', '--config=notify=[]'])).toMatchObject({
    command: undefined,
    prompt: '--config=notify=[]',
    values: {},
  })
})
it.each(['--config', '-c'])('rejects a missing required value for %s', option => {
  expect(() => parseCodex([option])).toThrow()
  expect(() => parseCodex([option, '--', prompt])).toThrow()
})
