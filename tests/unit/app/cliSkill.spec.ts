// @vitest-environment node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture } from './cliIdentity.helpers'
import { version } from '../../../package.json'

const skill = readFileSync('src/app/cli/skill/SKILL.md', 'utf8')
it('bundles the version-matched skill without runtime source file access', async () => {
  const content = execFileSync(process.execPath, [resolve('out/cli/opencove.mjs'), 'skill'], {
    cwd: '/tmp',
    encoding: 'utf8',
  })
  expect(content).toBe(skill)
  expect(skill.split('\n').length).toBeLessThanOrEqual(250)
  const f = identityFixture(false)
  expect(await run(['skill', '-o', 'json'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ version, content: skill })
  expect(f.fetch).not.toHaveBeenCalled()
})
it('parses every command line from SKILL.md in an offline help-only dry run', async () => {
  const lines = skill.split('\n').filter(line => line.startsWith('opencove '))
  expect(lines.length).toBeGreaterThan(20)
  for (const line of lines) {
    // Examples deliberately use literal words and double-quoted values, no shell expansion.
    const argv = line
      .match(/"[^"]*"|\S+/g)!
      .slice(1)
      .map(word => word.replace(/^"|"$/g, ''))
    const f = identityFixture(false)
    // eslint-disable-next-line no-await-in-loop
    expect(await run([...argv, '--help'], f.io), line).toBe(0)
    expect(f.fetch, line).not.toHaveBeenCalled()
    expect(f.io.readTextFile, line).not.toHaveBeenCalled()
  }
})
it('makes skill discoverable on the last line of root help and provides offline help', async () => {
  const f = identityFixture(false)
  expect(await run(['--help'], f.io)).toBe(0)
  expect(f.out().trimEnd().split('\n').at(-1)).toBe(
    'AI agents: run `opencove skill` for a usage guide.',
  )
  const guide = identityFixture(false)
  expect(await run(['skill', '--help'], guide.io)).toBe(0)
  expect(guide.out()).toMatchSnapshot()
})
