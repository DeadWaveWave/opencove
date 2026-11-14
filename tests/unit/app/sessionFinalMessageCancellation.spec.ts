// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionFinalMessageHandler } from '../../../src/app/main/controlSurface/handlers/sessionFinalMessageHandler'
import { resolveExecutionContextDto } from '../../../src/app/main/controlSurface/handlers/sessionLaunchSupport'
import type { SessionRecord } from '../../../src/app/main/controlSurface/handlers/sessionRecords'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import { locateAgentResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator'
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'
import { readLastAssistantMessageFromSessionFile } from '../../../src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage'
import { invokeControlSurface } from '../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient'

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator', () => ({
  locateAgentResumeSessionId: vi.fn(),
}))
vi.mock('../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver', () => ({
  resolveSessionFilePath: vi.fn(),
}))
vi.mock('../../../src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage', () => ({
  readLastAssistantMessageFromSessionFile: vi.fn(),
}))
vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: vi.fn(),
}))
afterEach(() => vi.resetAllMocks())

function fixture() {
  const controller = new AbortController()
  const record: SessionRecord = {
    sessionId: 's',
    provider: 'codex',
    cwd: '/workspace',
    startedAt: new Date(1000).toISOString(),
    startedAtMs: 1000,
    prompt: '',
    model: null,
    effectiveModel: null,
    resumeSessionId: null,
    command: 'codex',
    args: [],
    executionContext: resolveExecutionContextDto('/workspace'),
    route: { kind: 'local' },
  }
  const endpoint = { hostname: '127.0.0.1', port: 1, token: 'test' }
  const surface = createControlSurface()
  registerSessionFinalMessageHandler(surface, {
    sessions: new Map([['s', record]]),
    topology: { resolveRemoteEndpointConnection: async () => endpoint } as WorkerTopologyStore,
  })
  return {
    record,
    controller,
    invoke: (id: 'session.finalMessage' | 'session.finalMessageForNode') =>
      surface.invoke(
        {
          now: () => new Date(),
          capabilities: {} as ControlSurfaceContext['capabilities'],
          signal: controller.signal,
        },
        { kind: 'query', id, payload: { sessionId: 's' } },
      ),
  }
}

it.each(['session.finalMessage', 'session.finalMessageForNode'] as const)(
  '%s cannot publish a resume ID resolved after its client ended',
  async id => {
    const f = fixture()
    let release!: () => void
    vi.mocked(locateAgentResumeSessionId).mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve('late-id')
        }),
    )
    const result = f.invoke(id)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    f.controller.abort()
    release()
    expect(await result).toMatchObject({ ok: false })
    expect(f.record.resumeSessionId).toBeNull()
    expect(resolveSessionFilePath).not.toHaveBeenCalled()
  },
)

it.each(['file lookup', 'file read'] as const)(
  'rejects late %s success from a disposed lifetime',
  async phase => {
    const f = fixture()
    f.record.resumeSessionId = 'known-id'
    let release!: () => void
    vi.mocked(resolveSessionFilePath).mockResolvedValue('/session')
    vi.mocked(readLastAssistantMessageFromSessionFile).mockResolvedValue('answer')
    if (phase === 'file lookup') {
      vi.mocked(resolveSessionFilePath).mockImplementation(
        () =>
          new Promise(resolve => {
            release = () => resolve('/session')
          }),
      )
    } else {
      vi.mocked(readLastAssistantMessageFromSessionFile).mockImplementation(
        () =>
          new Promise(resolve => {
            release = () => resolve('answer')
          }),
      )
    }
    const result = f.invoke('session.finalMessage')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    f.controller.abort()
    release()
    expect(await result).toMatchObject({ ok: false })
    expect(f.record.resumeSessionId).toBe('known-id')
  },
)

it('forwards the local lifetime to remote discovery and rejects a late remote resume ID', async () => {
  const f = fixture()
  f.record.route = { kind: 'remote', endpointId: 'remote', remoteSessionId: 'remote-s' }
  let release!: () => void
  vi.mocked(invokeControlSurface).mockImplementation(
    () =>
      new Promise(resolve => {
        release = () =>
          resolve({
            httpStatus: 200,
            result: {
              __opencoveControlEnvelope: true,
              ok: true,
              value: { resumeSessionId: 'remote-late-id', message: 'answer' },
            },
          })
      }),
  )
  const result = f.invoke('session.finalMessage')
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  f.controller.abort()
  release()
  expect(await result).toMatchObject({ ok: false })
  expect(f.record.resumeSessionId).toBeNull()
  expect(invokeControlSurface).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ kind: 'query' }),
    { signal: f.controller.signal },
  )
})
