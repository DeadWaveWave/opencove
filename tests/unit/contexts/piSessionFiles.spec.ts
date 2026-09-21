import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'

vi.mock('../../../src/platform/os/HomeDirectory', () => ({
  resolveHomeDirectoryCandidates: () => [process.env.HOME],
}))

let root: string
let cwd: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'opencove-pi-files-'))
  cwd = join(root, 'workspace')
  vi.stubEnv('HOME', join(root, 'home'))
  vi.stubEnv('PI_CODING_AGENT_DIR', '')
  vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', '')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true })
})

async function seed(filePath: string): Promise<string> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(
    filePath,
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'saved-pi',
      cwd,
      timestamp: '2026-09-21T01:00:00.000Z',
    }) + '\n',
  )
  return filePath
}

async function resolveFixture(): Promise<string | null> {
  return await resolveSessionFilePath({
    provider: 'pi',
    cwd,
    sessionId: 'saved-pi',
    startedAtMs: 0,
    timeoutMs: 0,
  })
}

async function settings(directory: string, value: unknown): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(join(directory, 'settings.json'), JSON.stringify({ sessionDir: value }))
}

it('discovers sessions under the configured Pi agent directory', async () => {
  vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'agent'))
  const filePath = await seed(join(root, 'agent', 'sessions', '--project--', 'saved.jsonl'))
  expect(await resolveFixture()).toBe(filePath)
})

it('expands a tilde in the configured Pi agent directory', async () => {
  vi.stubEnv('PI_CODING_AGENT_DIR', '~/custom-agent')
  const filePath = await seed(
    join(root, 'home', 'custom-agent', 'sessions', '--project--', 'saved.jsonl'),
  )
  expect(await resolveFixture()).toBe(filePath)
})

it('uses the default Pi agent directory', async () => {
  const filePath = await seed(
    join(root, 'home', '.pi', 'agent', 'sessions', '--project--', 'saved.jsonl'),
  )
  expect(await resolveFixture()).toBe(filePath)
})

it('prefers the session environment directory over project and global settings', async () => {
  vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', '~/explicit-sessions')
  await settings(join(cwd, '.pi'), 'project-sessions')
  await settings(join(root, 'home', '.pi', 'agent'), 'global-sessions')
  const filePath = await seed(join(root, 'home', 'explicit-sessions', 'saved.jsonl'))
  expect(await resolveFixture()).toBe(filePath)
})

it('resolves project sessionDir relative to the requested cwd before global settings', async () => {
  await settings(join(cwd, '.pi'), '.pi/saved-sessions')
  await settings(join(root, 'home', '.pi', 'agent'), join(root, 'ignored'))
  const filePath = await seed(join(cwd, '.pi', 'saved-sessions', 'saved.jsonl'))
  expect(await resolveFixture()).toBe(filePath)
})

it('uses global sessionDir and falls back when project settings are malformed', async () => {
  vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'agent'))
  await settings(join(root, 'agent'), '~/global-sessions')
  await fs.mkdir(join(cwd, '.pi'), { recursive: true })
  await fs.writeFile(join(cwd, '.pi', 'settings.json'), '{broken')
  const filePath = await seed(join(root, 'home', 'global-sessions', 'saved.jsonl'))
  expect(await resolveFixture()).toBe(filePath)
})

it('preserves an explicit project clearing of a global sessionDir', async () => {
  await settings(join(cwd, '.pi'), null)
  await settings(join(root, 'home', '.pi', 'agent'), join(root, 'ignored'))
  const filePath = await seed(
    join(root, 'home', '.pi', 'agent', 'sessions', '--project--', 'saved.jsonl'),
  )
  expect(await resolveFixture()).toBe(filePath)
})
