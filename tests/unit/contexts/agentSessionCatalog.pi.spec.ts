import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { listAgentSessions } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionCatalog'
import { clearSessionFileCache } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionCatalog.cache'
import type { AgentSessionTitleCacheStore } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionTitleCacheStore'
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'

const directories: string[] = []

afterEach(async () => {
  clearSessionFileCache()
  vi.unstubAllEnvs()
  await Promise.all(
    directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })),
  )
})

it('reuses the shared title cache and tolerates its failure', async () => {
  const { root, cwd } = await seedSessions()
  const filePath = join(root, 'cached.jsonl')
  await writeSession(filePath, cwd, [
    { type: 'message', message: { role: 'user', content: 'Cached question' } },
  ])
  const write = vi.fn<AgentSessionTitleCacheStore['write']>()
  const read = vi.fn<AgentSessionTitleCacheStore['read']>().mockReturnValue(null)
  const titleCache: AgentSessionTitleCacheStore = {
    read,
    write,
    pruneMissing: () => 0,
    dispose: () => undefined,
  }
  const first = await listAgentSessions({ provider: 'pi', cwd }, { titleCache })
  expect(write).toHaveBeenCalledOnce()
  expect(write.mock.calls[0][0]).toMatchObject({ filePath, provider: 'pi' })

  clearSessionFileCache()
  read.mockReturnValue({ value: write.mock.calls[0][0].value })
  expect(await listAgentSessions({ provider: 'pi', cwd }, { titleCache })).toEqual(first)
  expect(write).toHaveBeenCalledOnce()

  clearSessionFileCache()
  read.mockImplementation(() => {
    throw new Error('unavailable cache')
  })
  write.mockImplementation(() => {
    throw new Error('unavailable cache')
  })
  expect(await listAgentSessions({ provider: 'pi', cwd }, { titleCache })).toEqual(first)
})

it('lists a saved Pi session so the session switch menu can select its exact file', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'opencove-pi-catalog-'))
  directories.push(root)
  const cwd = join(root, 'workspace')
  const filePath = join(root, 'saved-session.jsonl')
  vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', root)
  await fs.writeFile(
    filePath,
    [
      {
        type: 'session',
        version: 3,
        id: 'pi-saved-session',
        timestamp: '2026-09-21T01:00:00.000Z',
        cwd,
      },
      {
        type: 'message',
        id: 'user-entry',
        parentId: null,
        timestamp: '2026-09-21T01:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Restore this saved Pi session' }],
        },
      },
    ]
      .map(record => JSON.stringify(record))
      .join('\n') + '\n',
  )

  await expect(
    resolveSessionFilePath({
      provider: 'pi',
      cwd,
      sessionId: 'pi-saved-session',
      startedAtMs: Date.parse('2026-09-21T01:00:00.000Z'),
      timeoutMs: 0,
    }),
  ).resolves.toBe(filePath)
  const result = await listAgentSessions({ provider: 'pi', cwd, limit: 20 })

  expect(result.sessions).toEqual([
    expect.objectContaining({
      sessionId: filePath,
      provider: 'pi',
      cwd,
      title: 'Restore this saved Pi session',
    }),
  ])
})

async function seedSessions(): Promise<{ root: string; cwd: string }> {
  const root = await fs.mkdtemp(join(tmpdir(), 'opencove-pi-catalog-'))
  directories.push(root)
  vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', root)
  return { root, cwd: join(root, 'workspace') }
}

async function writeSession(
  filePath: string,
  cwd: string,
  entries: unknown[],
  timestamp = '2026-09-21T01:00:00.000Z',
): Promise<void> {
  await fs.writeFile(
    filePath,
    [{ type: 'session', version: 3, id: 'fixture', cwd, timestamp }, ...entries]
      .map(entry => JSON.stringify(entry))
      .join('\n') + '\n',
  )
}

it('shows the latest renamed title, then falls back to preview after an explicit name clear', async () => {
  const { root, cwd } = await seedSessions()
  const filePath = join(root, 'renamed.jsonl')
  await writeSession(filePath, cwd, [
    { type: 'message', message: { role: 'user', content: 'Original question' } },
    { type: 'session_info', name: 'Old title' },
    { type: 'session_info', name: 'New title' },
  ])
  expect((await listAgentSessions({ provider: 'pi', cwd })).sessions[0]).toMatchObject({
    title: 'New title',
    preview: 'Original question',
  })
  await fs.appendFile(filePath, JSON.stringify({ type: 'session_info', name: ' ' }) + '\n')
  expect((await listAgentSessions({ provider: 'pi', cwd })).sessions[0]).toMatchObject({
    title: 'Original question',
    preview: 'Original question',
  })
})

it('filters other workspaces and invalid headers while retaining sessions with broken tail records', async () => {
  const { root, cwd } = await seedSessions()
  const validPath = join(root, 'valid.jsonl')
  await writeSession(validPath, cwd, [
    {
      type: 'message',
      message: {
        role: 'user',
        content: [
          { type: 'image', data: 'ignored' },
          { type: 'text', text: 'Safe preview' },
        ],
      },
    },
  ])
  await fs.appendFile(validPath, '{partially appended')
  await writeSession(join(root, 'other.jsonl'), join(root, 'other-workspace'), [])
  await fs.writeFile(join(root, 'broken.jsonl'), '{broken}\n')
  await fs.writeFile(
    join(root, 'no-header.jsonl'),
    JSON.stringify({ type: 'message', message: { role: 'user', content: 'Not a session' } }) + '\n',
  )
  const result = await listAgentSessions({ provider: 'pi', cwd })
  expect(result.sessions).toEqual([
    expect.objectContaining({ sessionId: validPath, title: 'Safe preview' }),
  ])
})

it('sorts sessions by latest message activity and applies the requested limit', async () => {
  const { root, cwd } = await seedSessions()
  const olderPath = join(root, 'older.jsonl')
  const recentPath = join(root, 'recent.jsonl')
  await writeSession(recentPath, cwd, [
    {
      type: 'message',
      timestamp: '2026-09-21T03:00:00.000Z',
      message: { role: 'user', content: 'Recent activity' },
    },
  ])
  await writeSession(olderPath, cwd, [
    {
      type: 'message',
      timestamp: '2026-09-21T02:00:00.000Z',
      message: { role: 'user', content: 'Older activity' },
    },
  ])
  const result = await listAgentSessions({ provider: 'pi', cwd, limit: 1 })
  expect(result.sessions).toEqual([
    expect.objectContaining({
      sessionId: recentPath,
      startedAt: '2026-09-21T01:00:00.000Z',
      updatedAt: '2026-09-21T03:00:00.000Z',
    }),
  ])
})

it('invalidates cached summary when appending session content', async () => {
  const { root, cwd } = await seedSessions()
  const filePath = join(root, 'growing.jsonl')
  await writeSession(filePath, cwd, [])
  expect((await listAgentSessions({ provider: 'pi', cwd })).sessions[0]).toMatchObject({
    title: null,
  })
  await fs.appendFile(
    filePath,
    JSON.stringify({
      type: 'message',
      timestamp: '2026-09-21T04:00:00.000Z',
      message: { role: 'user', content: 'First saved turn' },
    }) + '\n',
  )
  expect((await listAgentSessions({ provider: 'pi', cwd })).sessions[0]).toMatchObject({
    title: 'First saved turn',
    updatedAt: '2026-09-21T04:00:00.000Z',
  })
})

it('finds the latest name and activity beyond 32 MiB in a long session', async () => {
  const { root, cwd } = await seedSessions()
  const filePath = join(root, 'long-session.jsonl')
  await writeSession(filePath, cwd, [
    {
      type: 'message',
      timestamp: '2026-09-21T01:00:00.000Z',
      message: { role: 'user', content: 'Original question' },
    },
    { type: 'session_info', name: 'Old name' },
  ])
  await fs.appendFile(
    filePath,
    JSON.stringify({
      type: 'message',
      message: { role: 'toolResult', content: 'x'.repeat(32 * 1024 * 1024) },
    }) + '\n',
  )
  await fs.appendFile(
    filePath,
    [
      { type: 'session_info', name: 'Latest name' },
      {
        type: 'message',
        timestamp: '2026-09-21T05:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Latest reply' }] },
      },
    ]
      .map(entry => JSON.stringify(entry))
      .join('\n') + '\n',
  )

  expect((await listAgentSessions({ provider: 'pi', cwd })).sessions[0]).toMatchObject({
    title: 'Latest name',
    preview: 'Original question',
    updatedAt: '2026-09-21T05:00:00.000Z',
  })
})

it('falls back from out-of-range message timestamps without losing other sessions', async () => {
  const { root, cwd } = await seedSessions()
  const fallbackPath = join(root, 'timestamp-fallback.jsonl')
  const headerPath = join(root, 'header-fallback.jsonl')
  await writeSession(fallbackPath, cwd, [
    {
      type: 'message',
      timestamp: '2026-09-21T05:00:00.000Z',
      message: { role: 'user', content: 'Use entry timestamp', timestamp: 1e20 },
    },
  ])
  await writeSession(headerPath, cwd, [
    {
      type: 'message',
      timestamp: 'invalid date',
      message: { role: 'user', content: 'Use header timestamp', timestamp: -1e20 },
    },
  ])

  expect((await listAgentSessions({ provider: 'pi', cwd })).sessions).toEqual([
    expect.objectContaining({ sessionId: fallbackPath, updatedAt: '2026-09-21T05:00:00.000Z' }),
    expect.objectContaining({ sessionId: headerPath, updatedAt: '2026-09-21T01:00:00.000Z' }),
  ])
})
