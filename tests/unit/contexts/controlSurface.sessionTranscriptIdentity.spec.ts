import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionFinalMessageHandler } from '../../../src/app/main/controlSurface/handlers/sessionFinalMessageHandler'
import type { SessionRecord } from '../../../src/app/main/controlSurface/handlers/sessionRecords'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import { resolveExecutionContextDto } from '../../../src/app/main/controlSurface/handlers/sessionLaunchSupport'
import {
  captureGeminiSessionDiscoveryCursor,
  findGeminiResumeSessionId,
} from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocatorProviders'
import { invokeControlSurface } from '../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient'

const homes = vi.hoisted(() => ({ paths: [] as string[] }))
vi.mock('../../../src/platform/os/HomeDirectory', () => ({
  resolveHomeDirectoryCandidates: () => homes.paths,
}))
vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: vi.fn(),
}))
const ctx = {} as ControlSurfaceContext
let root: string
let chats: string
let record: SessionRecord
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'opencove-transcript-identity-'))
  homes.paths = [root]
  const project = join(root, '.gemini/tmp/project')
  chats = join(project, 'chats')
  await fs.mkdir(chats, { recursive: true })
  await fs.writeFile(join(project, '.project_root'), root)
  const startedAtMs = Date.now()
  record = {
    sessionId: 'current',
    provider: 'gemini',
    startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    cwd: root,
    prompt: 'new',
    model: null,
    effectiveModel: null,
    executionContext: resolveExecutionContextDto(root),
    resumeSessionId: null,
    command: 'gemini',
    args: [],
    route: { kind: 'local' },
    launchMode: 'new',
  }
})
afterEach(async () => {
  vi.resetAllMocks()
  homes.paths = []
  await fs.rm(root, { recursive: true, force: true })
})
async function transcript(id: string, answer: boolean) {
  await fs.writeFile(
    join(chats, `session-${id}.json`),
    JSON.stringify({
      sessionId: id,
      startTime: record.startedAt,
      lastUpdated: record.startedAt,
      messages: [
        { type: 'user', timestamp: record.startedAt, content: 'hello' },
        ...(answer
          ? [{ type: 'gemini', timestamp: record.startedAt, content: `${id} answer` }]
          : []),
      ],
    }),
  )
}
function local(sessions: Map<string, SessionRecord>) {
  const surface = createControlSurface()
  registerSessionFinalMessageHandler(surface, {
    sessions,
    topology: {} as WorkerTopologyStore,
    resolveNode: async () => ({
      value: { ...record, nodeId: 'node', resumeSessionId: null },
      route: { kind: 'local' },
    }),
  })
  return surface
}
const query = (
  surface: ReturnType<typeof createControlSurface>,
  payload: unknown,
  id = 'session.finalMessage',
) => surface.invoke(ctx, { kind: 'query', id, payload })

it('keeps the current Gemini launch fence when a recent older conversation exists', async () => {
  await transcript('old', true)
  expect(await findGeminiResumeSessionId(root, record.startedAtMs)).toBe('old')
  record.geminiDiscoveryCursor = await captureGeminiSessionDiscoveryCursor(root)
  const surface = local(new Map([[record.sessionId, record]]))
  expect(await query(surface, { nodeId: 'node' })).toMatchObject({
    ok: false,
    error: { code: 'session.transcript_not_ready' },
  })
  await transcript('new', true)
  expect(await query(surface, { nodeId: 'node' })).toMatchObject({
    ok: true,
    value: { resumeSessionId: 'new', message: 'new answer' },
  })
}, 10000)

it.each(['absent', 'null-cursor', 'wrong-cwd'] as const)(
  'fails closed without trustworthy Gemini metadata: %s',
  async mode => {
    await transcript('old', true)
    const sessions = new Map<string, SessionRecord>()
    if (mode !== 'absent') {
      sessions.set(record.sessionId, {
        ...record,
        cwd: mode === 'wrong-cwd' ? join(root, 'other') : root,
        geminiDiscoveryCursor: mode === 'null-cursor' ? null : { entriesByFilePath: {} },
      })
    }
    expect(await query(local(sessions), { nodeId: 'node' })).toMatchObject({
      ok: false,
      error: { code: 'session.transcript_not_ready' },
    })
  },
)

it('preserves legacy sessionId discovery without a cursor', async () => {
  await transcript('old', true)
  expect(
    await query(local(new Map([[record.sessionId, record]])), { sessionId: record.sessionId }),
  ).toMatchObject({ ok: true, value: { resumeSessionId: 'old', message: 'old answer' } })
})

it('preserves legacy null results when no conversation has been written', async () => {
  expect(
    await query(local(new Map([[record.sessionId, record]])), { sessionId: ' current ' }),
  ).toMatchObject({
    ok: true,
    value: {
      sessionId: record.sessionId,
      provider: record.provider,
      cwd: record.cwd,
      startedAt: record.startedAt,
      resumeSessionId: null,
      message: null,
    },
  })
})

it('preserves legacy remote dispatch, public session identity and discovery caching', async () => {
  record.route = { kind: 'remote', endpointId: 'remote', remoteSessionId: 'remote-session' }
  const endpoint = { baseUrl: 'http://unused.invalid', token: 'fixture' }
  const surface = createControlSurface()
  registerSessionFinalMessageHandler(surface, {
    sessions: new Map([[record.sessionId, record]]),
    topology: {
      resolveRemoteEndpointConnection: async () => endpoint,
    } as unknown as WorkerTopologyStore,
  })
  vi.mocked(invokeControlSurface).mockResolvedValue({
    result: {
      ok: true,
      value: { sessionId: 'remote-session', resumeSessionId: null, message: null },
    },
  } as never)
  expect(await query(surface, { sessionId: ' current ' })).toMatchObject({
    ok: true,
    value: { sessionId: 'current', resumeSessionId: null, message: null },
  })
  vi.mocked(invokeControlSurface).mockResolvedValue({
    result: {
      ok: true,
      value: { sessionId: 'remote-session', resumeSessionId: 'conversation', message: 'done' },
    },
  } as never)
  expect(await query(surface, { sessionId: 'current' })).toMatchObject({
    ok: true,
    value: { sessionId: 'current', resumeSessionId: 'conversation', message: 'done' },
  })
  expect(record.resumeSessionId).toBe('conversation')
  expect(invokeControlSurface).toHaveBeenLastCalledWith(endpoint, {
    kind: 'query',
    id: 'session.finalMessage',
    payload: { sessionId: 'remote-session' },
  })
})

it('reuses the current runtime Gemini identity when the node has not persisted it yet', async () => {
  await transcript('current-conversation', true)
  record.resumeSessionId = 'current-conversation'
  expect(
    await query(local(new Map([[record.sessionId, record]])), { nodeId: 'node' }),
  ).toMatchObject({ ok: true, value: { resumeSessionId: 'current-conversation' } })
})

it('distinguishes remote missing transcripts from existing transcripts with no assistant turn', async () => {
  record.resumeSessionId = 'conversation'
  const remote = local(new Map([[record.sessionId, record]]))
  vi.mocked(invokeControlSurface).mockImplementation(
    async (_endpoint, request) =>
      ({
        result: await remote.invoke(ctx, request),
      }) as never,
  )
  const home = createControlSurface()
  registerSessionFinalMessageHandler(home, {
    sessions: new Map(),
    topology: {
      resolveRemoteEndpointConnection: async () => ({}),
    } as unknown as WorkerTopologyStore,
    resolveNode: async () => ({
      value: { ...record, nodeId: 'node', sessionId: 'home' },
      route: { kind: 'remote', endpointId: 'remote', remoteSessionId: record.sessionId },
    }),
  })
  expect(await query(home, { nodeId: 'node' })).toMatchObject({
    ok: false,
    error: { code: 'session.transcript_not_ready' },
  })
  expect(await query(remote, { sessionId: record.sessionId })).toMatchObject({
    ok: true,
    value: { resumeSessionId: 'conversation', message: null },
  })
  await transcript('conversation', false)
  expect(await query(home, { nodeId: 'node' })).toMatchObject({
    ok: true,
    value: { resumeSessionId: 'conversation', message: null },
  })
}, 10000)
