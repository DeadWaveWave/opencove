// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionInputHandlers } from '../../../src/app/main/controlSurface/handlers/sessionInputHandlers'
import { registerOperationIntrospectionHandlers } from '../../../src/app/main/controlSurface/handlers/operationIntrospectionHandlers'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

it.each(['idle', 'exited', 'exit-during-read'])(
  'joins real schema negotiation to Worker eligibility: %s',
  async scenario => {
    const nodeId = '00000000-0000-4000-8000-000000000001'
    const state = createMinimalState('/repo', 'project', 'space')
    state.workspaces[0].nodes = [
      {
        id: nodeId,
        kind: 'terminal',
        sessionId: 'shell',
        title: 'codex · Reviewer',
        titlePinnedByUser: true,
        titleIsLiteral: true,
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        status: 'running',
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        task: null,
        agent: null,
        scrollback: null,
        labelColorOverride: null,
      },
    ]
    const store = createInMemoryPersistenceStore()
    await store.writeAppState(state)
    let agentState = scenario === 'exited' ? 'exited' : 'idle'
    const kill = vi.fn()
    const surface = createControlSurface()
    const observation = () => ({ nodeId, sessionId: 'shell', state: agentState })
    surface.register('node.get', {
      kind: 'query',
      validate: value => value,
      defaultErrorCode: 'node.not_found',
      handle: () => ({
        node: { ...state.workspaces[0].nodes[0], projectId: 'project', spaceId: 'space' },
      }),
    })
    surface.register('agent.get', {
      kind: 'query',
      validate: value => value,
      defaultErrorCode: 'common.unexpected',
      handle: observation,
    })
    registerSessionInputHandlers(surface, {
      getPersistenceStore: async () => {
        if (scenario === 'exit-during-read') {
          agentState = 'exited'
        }
        return store
      },
      ptyRuntime: { kill },
      ptyStreamHub: {
        isSessionActive: () => true,
        observeAgentState: observation,
      } as unknown as PtyStreamHub,
    })
    registerOperationIntrospectionHandlers(surface)
    let output = '',
      error = ''
    const requests: string[] = []
    const io: CliIo = {
      env: { OPENCOVE_CONTROL_URL: 'http://in-memory', OPENCOVE_CONTROL_TOKEN: 'test' },
      stdout: {
        write: value => {
          output += value
        },
      },
      stderr: {
        write: value => {
          error += value
        },
      },
      readTextFile: vi.fn(),
      readStdinText: vi.fn(),
      now: Date.now,
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body))
        requests.push(request.id)
        return new Response(
          JSON.stringify(await surface.invoke({ now: () => new Date() }, request)),
        )
      },
    }
    expect(await run(['agent', 'stop', '--node', nodeId], io), error).toBe(0)
    expect(JSON.parse(output)).toEqual({
      nodeId,
      sessionId: 'shell',
      stopped: scenario === 'idle',
      ...(scenario === 'idle' ? {} : { reason: 'not_running' }),
    })
    expect(kill).toHaveBeenCalledTimes(scenario === 'idle' ? 1 : 0)
    if (scenario !== 'exited') {
      expect(requests).toContain('system.operation.describe')
    }
    expect(await store.readAppState()).toEqual(state)
  },
)
