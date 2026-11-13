// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import {
  INITIAL_PROMPT_RULES,
  INITIAL_PROMPT_RULES_TEXT,
} from '../../../src/shared/errors/initialPromptRules'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture } from './cliIdentity.helpers'
import { initialPromptPresentations } from '../../../src/shared/errors/initialPromptFeedback'

it('lists each refusal category once in the canonical rules', () => {
  expect(INITIAL_PROMPT_RULES.map(rule => rule.kind)).toEqual(
    Object.keys(initialPromptPresentations),
  )
  expect(INITIAL_PROMPT_RULES.map(rule => rule.kind)).toEqual([
    'command_token',
    'provider_command_prefix',
    'provider_exit_word',
    'unverified_file_reference',
    'provider_skill_reference',
    'leading_dash',
    'nul',
  ])
})

it.each([
  ['node', 'create', 'agent', '--help'],
  ['agent', 'prompt', '--help'],
  ['skill', 'access'],
])('prints the canonical rules offline in %j', async (...args) => {
  const f = identityFixture(false)
  expect(await run(args, f.io)).toBe(0)
  expect(f.out()).toContain(INITIAL_PROMPT_RULES_TEXT)
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each(['src/app/cli/skill/topics/access.md', 'docs/agent/INITIAL_PROMPTS.md'])(
  '%s contains the exact canonical rules',
  path => {
    const content = readFileSync(path, 'utf8')
    expect(
      content
        .split('<!-- initial-prompt-rules:start -->\n')[1]
        ?.split('\n<!-- initial-prompt-rules:end -->')[0],
    ).toBe(INITIAL_PROMPT_RULES_TEXT)
  },
)
