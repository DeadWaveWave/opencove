// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createAgentSpawnRuntime } from '../../../src/app/main/controlSurface/agentSpawnRuntime'
import { AgentSpawnAdmissionOwner } from '../../../src/contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner'
import { canvasSpawnIdentity } from '../../../src/app/main/controlSurface/sessionSpawnIdentityContext'
import { invokeControlSurface } from '../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { ResolvedNodeCreationTarget } from '../../../src/contexts/workspace/application/nodeControl/nodeCreationTarget'

it('does not let local completion history hide a later human remote incarnation deleted before admission', async () => {
  let emitExit: (event: { sessionId: string; exitCode: number }) => void = () => {}
  const tracked = createAgentSpawnRuntime({
    spawnSession: async () => ({ sessionId: 'local' }),
    kill: () => {},
    write: () => {},
    resize: async () => ({ status: 'session_not_found' }) as never,
    onData: () => () => {},
    onExit: listener => {
      emitExit = listener
      return () => {}
    },
  })
  const identity = { nodeId: 'child', projectId: 'p', spaceId: '' }
  await canvasSpawnIdentity.run(identity, () =>
    tracked.runtime.spawnSession({
      cwd: '/repo',
      command: 'fixture',
      args: [],
      cols: 80,
      rows: 24,
    }),
  )
  emitExit({ sessionId: 'local', exitCode: 0 })
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { sessionId: 'remote' },
          }),
        ),
    ),
  )
  try {
    const dispatch = () =>
      canvasSpawnIdentity.run(identity, () =>
        invokeControlSurface(
          { hostname: 'fixture', port: 123, token: 'user' },
          { kind: 'command', id: 'pty.spawn', payload: { cwd: '/remote' } },
        ),
      )
    // Older adapters have no remote observation scope: still exercise the real forwarding boundary.
    const observer = tracked as typeof tracked & { observeRequests?: <T>(execute: () => T) => T }
    await (observer.observeRequests ? observer.observeRequests(dispatch) : dispatch())
    const row = { nodeId: 'child', spawnedBy: 'root', rootNodeId: 'root', lineageDepth: 2 }
    const store = {
      readAppStateRevision: async () => 2,
      readAppState: async () => ({
        workspaces: [{ nodes: [{ id: 'root', kind: 'agent', sessionId: 'root-session' }] }],
      }),
      nodeLineage: {
        readMany: async () => new Map([['child', row]]),
        readAll: async () => new Map([['child', row]]),
      },
      commitCreatedNodeState: vi.fn(),
    } as unknown as NodeControlAppStateStore
    const owner = new AgentSpawnAdmissionOwner(tracked.port)
    const create = vi.fn()
    await expect(
      owner.runCreation(
        store,
        {
          authority: { grantId: 'g', nodeId: 'root', sessionId: 'root-session' },
          nodeId: 'next',
          kind: 'agent',
          target: {
            workspace: { id: 'p' },
            endpoint: { kind: 'local', endpointId: 'local' },
            workingDirectory: '/repo',
          } as ResolvedNodeCreationTarget,
          assertActive: () => {},
        },
        create,
      ),
    ).rejects.toMatchObject({ code: 'common.unavailable' })
    expect(create).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
    tracked.dispose()
  }
})
