// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { commands } from '../../../src/app/cli/commands'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture } from './cliIdentity.helpers'

function correlations(text: string) {
  const normalized = text.replace(/\s+/g, ' ')
  for (const phrase of [
    'deliveryIds',
    'promptIds',
    'retained correlations',
    'promptIds are the provider',
    'refused',
    'uncertain',
    'neither submission nor consumption',
    'opencove agent delivery <id>',
    'inspect each deliveryId',
  ]) {
    expect(normalized).toContain(phrase)
  }
}
it.each(['read', 'wait'])('shipped %s help explains correlation trust limits', async action => {
  const f = identityFixture(false)
  expect(await run(['agent', action, '--help'], f.io)).toBe(0)
  correlations(f.out())
})
it('core guide keeps first-action rules and topic discovery', async () => {
  const f = identityFixture(false)
  expect(await run(['skill'], f.io)).toBe(0)
  const guide = f.out().replace(/\s+/g, ' ')
  for (const rule of [
    'whoami',
    'context',
    'ai_done',
    'human acceptance',
    'Ask before delegating',
    "Never answer another agent's dialogs",
    'Never resend',
    'confirm delivery',
    'wait --turn',
    'run_in_background: true',
    'foreground',
    'exit 124',
  ]) {
    expect(guide, rule).toContain(rule)
  }
  for (const topic of ['canvas', 'coordinate', 'wait', 'read', 'access']) {
    expect(guide).toContain(`opencove skill ${topic}`)
  }
})
it.each([
  [
    'canvas',
    [
      '--root-canvas',
      'space create',
      'project add',
      'ai_done',
      'automatic titles',
      'entire terminal session',
    ],
  ],
  [
    'coordinate',
    [
      'claude-code-v1',
      '2.1.319',
      'trailing ASCII whitespace',
      'leading/interior',
      'StopFailure',
      'notify-only',
      'daemon reuse',
      'file-only telemetry',
      'Windows',
      'executable_override_unverified',
      'option-like',
      '32 KiB',
      'valid Unicode',
      'same wall clock',
      'hook token',
      'five-second',
      '--expect-turn',
      'dispatched',
      'Never resend',
      'run_in_background: true',
      'foreground',
    ],
  ],
  [
    'wait',
    [
      '2147483647',
      '--all',
      '--any',
      'Exit 10',
      'Exit 11',
      '0/unknown',
      'same --turn',
      'lastEndedTurn',
    ],
  ],
  [
    'read',
    [
      'no_ended_turn',
      'provider_sent_no_message',
      'empty or whitespace-only hook',
      'truncated',
      'session final --session',
      '64 KiB',
      '60 turns/node',
      'opencove agent history clear',
      '30 days',
      '20,000',
      '128 MiB',
      'messageKind: intermediate',
      'current-incarnation',
      'remote_history_unavailable',
      'normal/alternate',
      'CJK/emoji',
      'row-end spaces',
      '--lines requires --screen',
      '--screen conflicts with --last and --turn',
      'Codex stores the first matching Stop reply',
    ],
  ],
  [
    'access',
    [
      'Settings',
      'rejectedFields',
      'field_denied',
      'Full Access Mode',
      'Tell agents about OpenCove',
      'one-word',
      'Project isolation is not yet enforced',
    ],
  ],
] as const)('topic %s owns its operational guidance', async (topic, facts) => {
  const f = identityFixture(false)
  expect(await run(['skill', topic], f.io)).toBe(0)
  const guide = f.out().replace(/\s+/g, ' ')
  for (const fact of facts) {
    expect(guide, fact).toContain(fact)
  }
  if (topic === 'read' || topic === 'wait') {
    correlations(guide)
  }
})
it('mirrored prompt skill explains the same correlation limits', () => {
  correlations(readFileSync('docs/cli/skills/opencove-agent-prompt/SKILL.md', 'utf8'))
})
it('every shipped command help and skill is usable outside the repository', async () => {
  for (const command of commands) {
    const f = identityFixture(false)
    // eslint-disable-next-line no-await-in-loop
    expect(await run([...command.path, '--help'], f.io)).toBe(0)
    expect(f.out(), command.path.join(' ')).not.toContain('docs/')
    for (const option of Object.values(command.options ?? {})) {
      expect(option.description).not.toContain('docs/')
    }
  }
  const f = identityFixture(false)
  expect(await run(['skill'], f.io)).toBe(0)
  expect(f.out()).not.toContain('docs/')
})
it('space get uses a top-level type import', () => {
  const source = readFileSync('src/app/cli/commands/index.ts', 'utf8')
  expect(source).not.toContain("as import('../../../shared/contracts/dto').GetSpaceResult")
  expect(source).toMatch(
    /import type \{[^}]*GetSpaceResult[^}]*\} from '\.\.\/\.\.\/\.\.\/shared\/contracts\/dto'/,
  )
})

it.each([
  ['create', 'agent'],
  ['create', 'terminal'],
  ['update', 'agent'],
  ['update', 'terminal'],
])('node %s %s help keeps the title value separate from its description', async (action, kind) => {
  const f = identityFixture(false)
  expect(await run(['node', action, kind, '--help'], f.io)).toBe(0)
  expect(f.out()).toMatch(
    /--title <text>\s+Set a fixed window name; omit on creation to keep automatic titles/,
  )
  expect(f.out()).not.toContain('--title <set-a-fixed')
})

it('core guide checks session identity with whoami before consulting environment hints', async () => {
  const f = identityFixture(false)
  expect(await run(['skill'], f.io)).toBe(0)
  const guide = f.out().replace(/\s+/g, ' ')
  expect(guide).toContain('Run `opencove whoami` first')
  expect(guide).toContain('exit 3 or 4')
  expect(guide).toContain('ask the user for an authorized endpoint or profile')
  expect(guide).toContain("Never search for or modify a real user's profile or tokens")
  expect(guide).not.toContain('Check `OPENCOVE_ENV=1` before')
  const firstExample = f.out().split('```sh\n')[1].split('\n')[0]
  expect(firstExample).toBe('opencove whoami')
})

it('canvas guide creates a Space, binds a worktree, then launches the delegated agent', async () => {
  const f = identityFixture(false)
  expect(await run(['skill', 'canvas'], f.io)).toBe(0)
  const guide = f.out().replace(/\s+/g, ' ')
  const recipe = guide.slice(guide.indexOf('## Give a delegated agent its own worktree'))
  expect(recipe).toContain('project must be a Git repository with an initial commit')
  expect(recipe).toContain('worktree.not_a_git_repo')
  expect(recipe).toContain('This directory is not a Git repository.')
  expect(recipe).toContain('exit 1')
  expect(recipe).toContain('repository root')
  expect(recipe).toContain('--in')
  expect(recipe).toContain('--name is optional')
  const createSpace = recipe.indexOf('opencove space create --name "Review work"')
  const createWorktree = recipe.indexOf(
    'opencove worktree create --space space-123 --name review-work',
  )
  const launchAgent = recipe.indexOf(
    'opencove node create agent --space space-123 --title "Reviewer"',
  )
  expect(createSpace).toBeGreaterThanOrEqual(0)
  expect(createWorktree).toBeGreaterThan(createSpace)
  expect(launchAgent).toBeGreaterThan(createWorktree)
})
