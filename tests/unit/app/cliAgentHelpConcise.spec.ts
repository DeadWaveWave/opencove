// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { commands } from '../../../src/app/cli/commands'

it.each(['prompt', 'wait', 'read'])(
  'agent %s help keeps operational basics and links detailed semantics',
  action => {
    const description = commands.find(c => c.path.join(' ') === `agent ${action}`)!.description!
    expect(description.split(/\s+/).length).toBeLessThan(250)
    expect(description).toContain('opencove skill')
    expect(description).toMatch(/never resend/i)
    expect(description).toContain('Exit codes:')
  },
)

it('documents the read turn option without advertising expect-turn support', () => {
  const description = commands.find(c => c.path.join(' ') === 'agent read')!.description!
  expect(description).toContain('--turn requires one target')
  expect(description).toContain('--expect-turn is unsupported')
  expect(description).not.toContain('--turn/--expect-turn require one target')
})

it.each(['README.md', 'docs/cli/README.md', 'src/app/cli/skill/topics/read.md'])(
  '%s distinguishes unsupported expect-turn from the single-target turn option',
  file => {
    const text = readFileSync(file, 'utf8').replace(/\s+/g, ' ')
    expect(text).toContain('`--expect-turn` is unsupported by `agent read`')
    expect(text).not.toContain('`--turn` / `--expect-turn`')
  },
)
