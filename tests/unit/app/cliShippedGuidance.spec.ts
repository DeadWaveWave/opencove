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
it('bundled skill output carries correlation trust limits and every removed operational topic', async () => {
  const f = identityFixture(false)
  expect(await run(['skill'], f.io)).toBe(0)
  correlations(f.out())
  const guide = f.out().replace(/\s+/g, ' ')
  for (const fact of [
    'no_ended_turn',
    'provider_sent_no_message',
    'empty or whitespace-only hook',
    'truncated',
    'session final --session',
    '64 KiB',
    '50 turns/node',
    '30 days',
    '20,000',
    '128 MiB',
    'claude-code-v1',
    '2.1.319',
    'trailing ASCII whitespace',
    'leading/interior',
    'unavailable',
    'StopFailure',
    'notify-only',
    'daemon reuse',
    'file-only telemetry',
    'Windows',
    'executable_override_unverified',
    'Settings',
    'option-like',
    '32 KiB',
    'valid Unicode',
    'same wall clock',
    'hook token',
    'five-second',
    '2147483647',
    'messageKind: intermediate',
    'current-incarnation',
    'remote_history_unavailable',
    'normal/alternate',
    'CJK/emoji',
    'row-end spaces',
    '--lines requires --screen',
    '--screen conflicts with --last and --turn',
  ]) {
    expect(guide, fact).toContain(fact)
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
