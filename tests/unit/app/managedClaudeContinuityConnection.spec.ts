// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { syntheticRebind } from '../../e2e/managedClaudeContinuity.helpers'
import { waitForControlSurfaceConnection } from '../../e2e/controlSurfaceConnection.helpers'
import * as cliIo from '../../../src/app/cli/core/io'

let root: string | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture(fileName: string) {
  root = await mkdtemp(path.join(tmpdir(), 'opencove-continuity-connection-'))
  const profile = path.join(root, 'profile')
  const home = path.join(root, 'home')
  const workspace = path.join(root, 'workspace')
  const transcripts = path.join(
    home,
    '.claude',
    'projects',
    path.resolve(workspace).replace(/[^A-Za-z0-9]/gu, '-'),
  )
  await mkdir(profile, { recursive: true })
  await mkdir(transcripts, { recursive: true })
  await writeFile(path.join(transcripts, 'A.jsonl'), '{"sessionId":"A"}\n')
  const record = {
    version: 1,
    hostname: '127.0.0.1',
    port: 4312,
    token: 'test-token',
    pid: process.pid,
    createdAt: new Date().toISOString(),
  }
  await writeFile(path.join(profile, fileName), JSON.stringify(record))
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ status: 'committed', revision: 2 })),
  )
  vi.stubGlobal('fetch', fetch)
  return { profile, home, workspace, transcripts, fetch, record }
}

it.each(['control-surface.json', 'worker-control-surface.json'])(
  'rebinds through the live %s connection and prepares the next resume transcript',
  async fileName => {
    const f = await fixture(fileName)
    const next = await syntheticRebind(f.profile, f.home, f.workspace, 'agent', 'A')
    expect(f.fetch).toHaveBeenCalledExactlyOnceWith(
      'http://127.0.0.1:4312/_test/managed-claude-rebind',
      {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId: 'agent', resumeSessionId: next }),
      },
    )
    expect(await readFile(path.join(f.transcripts, `${next}.jsonl`), 'utf8')).toBe(
      `{"sessionId":"${next}"}\n`,
    )
  },
)

it.each(['control-surface.json', 'worker-control-surface.json'])(
  'uses CLI discovery for %s without inheriting parent-shell credentials',
  async fileName => {
    const f = await fixture(fileName)
    vi.stubEnv('OPENCOVE_CONTROL_URL', 'http://unrelated-profile.test')
    vi.stubEnv('OPENCOVE_CONTROL_TOKEN', 'unrelated-token')
    vi.stubEnv('OPENCOVE_USER_DATA_DIR', path.join(root!, 'unrelated-profile'))
    const listeners = process.listenerCount('SIGINT')
    expect(await waitForControlSurfaceConnection(f.profile)).toMatchObject({
      endpoint: 'http://127.0.0.1:4312',
      token: 'test-token',
    })
    expect(process.listenerCount('SIGINT')).toBe(listeners)
  },
)

it('waits for an incomplete Worker file to become valid instead of returning early', async () => {
  const f = await fixture('worker-control-surface.json')
  const file = path.join(f.profile, 'worker-control-surface.json')
  await writeFile(file, '{"version":')
  let firstRead!: () => void
  const attempted = new Promise<void>(resolve => {
    firstRead = resolve
  })
  const create = cliIo.createNodeCliIo
  vi.spyOn(cliIo, 'createNodeCliIo').mockImplementation(() => {
    const io = create()
    return {
      ...io,
      readTextFile: async name => {
        const value = await io.readTextFile(name)
        if (name === file) {
          firstRead()
        }
        return value
      },
    }
  })
  const listeners = process.listenerCount('SIGINT')
  let settled = false
  const connecting = waitForControlSurfaceConnection(f.profile).finally(() => {
    settled = true
  })
  try {
    await attempted
    expect(settled).toBe(false)
    await writeFile(file, JSON.stringify(f.record))
    expect(await connecting).toMatchObject({
      endpoint: 'http://127.0.0.1:4312',
      token: 'test-token',
    })
    expect(process.listenerCount('SIGINT')).toBe(listeners)
  } finally {
    await connecting.catch(() => undefined)
  }
})

it('rejects two live files immediately and disposes the CLI listener', async () => {
  const f = await fixture('worker-control-surface.json')
  await writeFile(
    path.join(f.profile, 'control-surface.json'),
    JSON.stringify({ ...f.record, port: 4313 }),
  )
  const listeners = process.listenerCount('SIGINT')
  const timer = vi.spyOn(globalThis, 'setTimeout')
  await expect(waitForControlSurfaceConnection(f.profile)).rejects.toMatchObject({
    code: 'context.ambiguous',
  })
  expect(timer).not.toHaveBeenCalled()
  expect(process.listenerCount('SIGINT')).toBe(listeners)
})

it('bounds an unavailable profile wait without escaping to a parent profile', async () => {
  const f = await fixture('worker-control-surface.json')
  const listeners = process.listenerCount('SIGINT')
  await expect(
    waitForControlSurfaceConnection(path.join(root!, 'missing-profile'), 50),
  ).rejects.toMatchObject({
    code: 'context.unreachable',
    details: { profiles: [path.join(root!, 'missing-profile')] },
  })
  expect(process.listenerCount('SIGINT')).toBe(listeners)
  expect(f.fetch).not.toHaveBeenCalled()
})

it('rediscovers the Worker after restart before the next synthetic rebind', async () => {
  const f = await fixture('worker-control-surface.json')
  const next = await syntheticRebind(f.profile, f.home, f.workspace, 'agent', 'A')
  await writeFile(
    path.join(f.profile, 'worker-control-surface.json'),
    JSON.stringify({
      ...f.record,
      port: 4313,
      token: 'restarted-token',
    }),
  )
  const finalId = await syntheticRebind(f.profile, f.home, f.workspace, 'agent', next)
  expect(f.fetch).toHaveBeenLastCalledWith('http://127.0.0.1:4313/_test/managed-claude-rebind', {
    method: 'POST',
    headers: { authorization: 'Bearer restarted-token', 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'agent', resumeSessionId: finalId }),
  })
  expect(f.fetch).toHaveBeenCalledTimes(2)
  expect(await readFile(path.join(f.transcripts, `${finalId}.jsonl`), 'utf8')).toBe(
    `{"sessionId":"${finalId}"}\n`,
  )
})
