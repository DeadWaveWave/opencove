// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture } from './cliIdentity.helpers'
import { version } from '../../../package.json'

const topics = ['canvas', 'coordinate', 'wait', 'read', 'access', 'events']
const source = (topic: string) =>
  readFileSync(`src/app/cli/skill/${topic ? `topics/${topic}.md` : 'SKILL.md'}`, 'utf8')

it.each(['', ...topics])('bundles the offline %s guide within its budget', async topic => {
  const content = source(topic)
  const args = ['skill', ...(topic ? [topic] : [])]
  expect(
    (content.endsWith('\n') ? content.slice(0, -1) : content).split('\n').length,
  ).toBeLessThanOrEqual(topic ? 180 : 120)
  expect(Buffer.byteLength(content)).toBeLessThanOrEqual((topic ? 16 : 8) * 1024)
  const cwd = mkdtempSync(join(tmpdir(), 'opencove-skill-'))
  try {
    expect(
      execFileSync(process.execPath, [resolve('out/cli/opencove.mjs'), ...args], {
        cwd,
        env: { ...process.env, OPENCOVE_CONTROL_URL: 'http://127.0.0.1:1' },
        encoding: 'utf8',
      }),
    ).toBe(content)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
  const f = identityFixture(false)
  expect(await run([...args, '-o', 'json'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ version, content, ...(topic ? { topic } : {}) })
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.io.readTextFile).not.toHaveBeenCalled()
  for (const fields of ['version', 'content', ...(topic ? ['topic', 'topic,content'] : [])]) {
    const projected = identityFixture(false)
    // eslint-disable-next-line no-await-in-loop
    expect(await run([...args, '--fields', fields], projected.io)).toBe(0)
    const expected = { version, content, topic }
    expect(JSON.parse(projected.out())).toEqual(
      Object.fromEntries(
        fields.split(',').map(field => [field, expected[field as keyof typeof expected]]),
      ),
    )
    expect(projected.fetch).not.toHaveBeenCalled()
  }
})

it.each(['', ...topics])(
  'parses command examples from the %s guide without connecting',
  async topic => {
    const lines = source(topic)
      .split('\n')
      .filter(line => line.startsWith('opencove '))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
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
  },
)

it('indexes exactly the bundled topic files in the core guide', () => {
  expect(readdirSync('src/app/cli/skill/topics').sort()).toEqual(topics.map(t => `${t}.md`).sort())
  const indexed = [...source('').matchAll(/^- `opencove skill (\w+)`/gm)].map(match => match[1])
  expect(indexed).toEqual(topics)
})

it.each(['missing', 'constructor', '__proto__', 'Canvas'])(
  'rejects unknown topic %s offline with usage exit 2',
  async topic => {
    const f = identityFixture(false)
    expect(await run(['skill', topic, '-o', 'json'], f.io)).toBe(2)
    expect(f.out()).toBe('')
    expect(f.error()).toMatchObject({ code: 'cli.usage' })
    for (const name of topics) {
      expect(f.error().message).toContain(name)
    }
    expect(f.fetch).not.toHaveBeenCalled()
    const result = spawnSync(
      process.execPath,
      [resolve('out/cli/opencove.mjs'), 'skill', topic, '-o', 'json'],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr).error.code).toBe('cli.usage')
  },
)

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
