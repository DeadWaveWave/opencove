// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { installAgentSpawnOwner } from '../../../src/app/main/controlSurface/agentSpawnContext'
import { AgentSpawnAdmissionOwner } from '../../../src/contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { ResolvedNodeCreationTarget } from '../../../src/contexts/workspace/application/nodeControl/nodeCreationTarget'
import { authorizationError } from '../../../src/app/cli/core/authorizationError'
import {
  agentSpawnErrorPresentation,
  spawnForbiddenDetails,
} from '../../../src/shared/errors/agentSpawnError'
import { enMessages } from '../../../src/app/renderer/i18n/locales/en.messages'
import { zhCNMessages } from '../../../src/app/renderer/i18n/locales/zh-CN.messages'
const raw = [
  'session.launchAgent',
  'session.launchAgentInMount',
  'session.spawnTerminal',
  'pty.spawn',
  'pty.spawnInMount',
]
const grant = {
  grantId: 'g',
  nodeId: 'caller',
  sessionId: 'caller-session',
  projectId: 'p',
  spaceId: 's',
  tier: 'interact' as const,
  createdAt: '',
}
const base = createControlSurfaceHttpServerContext({
  enableWebShell: false,
  ptyProtocolVersion: 1,
  replayWindowMaxBytes: 10,
})
const ctx = { ...base, requestAuth: { kind: 'session-grant' as const, grant } }
it.each(raw)(
  'refuses direct grant %s before handler side effects, but exempts the user',
  async id => {
    const surface = createControlSurface(),
      handle = vi.fn(() => null)
    surface.register(id, {
      kind: 'command',
      validate: x => x,
      handle,
      defaultErrorCode: 'common.unexpected',
    })
    const result = await surface.invoke(ctx, { kind: 'command', id, payload: {} })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'common.forbidden',
        details: { spawnReason: 'node_create_required', retryable: false },
      },
    })
    expect(handle).not.toHaveBeenCalled()
    expect(
      await surface.invoke(
        { ...base, requestAuth: { kind: 'bearer' } },
        { kind: 'command', id, payload: {} },
      ),
    ).toMatchObject({ ok: true })
  },
)
it.each(['session.launchAgent', 'session.launchAgentInMount', 'pty.spawn', 'pty.spawnInMount'])(
  'permits admitted internal %s without substituting bearer authority',
  async id => {
    const surface = createControlSurface()
    const owner = new AgentSpawnAdmissionOwner({
      snapshot: () => ({ revision: 0, bindings: [] }),
      isCurrent: () => true,
    })
    installAgentSpawnOwner(surface, owner)
    const store = {
      readAppStateRevision: async () => 0,
      readAppState: async () => ({
        workspaces: [{ nodes: [{ id: 'caller', kind: 'agent', sessionId: 'caller-session' }] }],
      }),
      nodeLineage: { readMany: async () => new Map(), readAll: async () => new Map() },
      commitCreatedNodeState: vi.fn(),
    } as unknown as NodeControlAppStateStore
    const target = {
      endpoint: { kind: 'local', endpointId: 'local' },
      workspace: { id: 'p' },
      workingDirectory: '/repo',
    } as ResolvedNodeCreationTarget
    surface.register(id, {
      kind: 'command',
      validate: x => x,
      handle: context => {
        expect(context.requestAuth).toEqual(ctx.requestAuth)
        owner.consume(context.agentSpawnPermit!)
        return null
      },
      defaultErrorCode: 'common.unexpected',
    })
    await owner.runCreation(
      store,
      {
        authority: grant,
        nodeId: 'child',
        kind: id.startsWith('pty.') ? 'terminal' : 'agent',
        target,
        assertActive: () => {},
      },
      async permit => {
        const admitted = {
          ...ctx,
          spawnIdentity: { projectId: 'p', spaceId: 's', nodeId: 'child' },
          agentSpawnPermit: permit,
        }
        expect(await surface.invoke(admitted, { kind: 'command', id, payload: {} })).toMatchObject({
          ok: true,
        })
        expect(await surface.invoke(admitted, { kind: 'command', id, payload: {} })).toMatchObject({
          ok: false,
        })
      },
    )
  },
)
it.each([
  'session.prepareOrRevive',
  'plugin.command.run',
  'plugin.invoke',
  'plugin.host.request',
  'plugin.view.open',
  'plugin.window.open',
])('preserves grant denial of %s', async id => {
  const surface = createControlSurface(),
    handle = vi.fn()
  surface.register(id, {
    kind: 'command',
    validate: x => x,
    handle,
    defaultErrorCode: 'common.unexpected',
  })
  expect(await surface.invoke(ctx, { kind: 'command', id, payload: {} })).toMatchObject({
    ok: false,
    error: { code: 'common.forbidden' },
  })
  expect(handle).not.toHaveBeenCalled()
})
it('provides finished old-CLI messages and localized hints, including session exit semantics', () => {
  for (const reason of [
    'node_create_required',
    'caller_node_required',
    'caller_session_mismatch',
    'remote_spawning_unsupported',
  ] as const) {
    const details = spawnForbiddenDetails(reason)
    const oldFormatter = (error: { details: { message: string } }) => error.details.message
    expect(oldFormatter({ details })).toContain(details.hint)
    expect(authorizationError(403, { code: 'common.forbidden', details })?.hint).toBe(details.hint)
  }
  const presentation = agentSpawnErrorPresentation({ code: 'agent.spawn_concurrency_limit' })!
  expect(presentation.hint).toContain('exit')
  expect(enMessages.agentSpawnConcurrencyHint).toContain('Finishing a turn does not free a slot')
  for (const locale of [enMessages, zhCNMessages]) {
    for (const key of [
      'agentSpawnDepth',
      'agentSpawnConcurrency',
      'agentSpawnRoute',
      'agentSpawnCaller',
      'agentSpawnBinding',
      'agentSpawnRemote',
      'agentSpawnAccounting',
    ] as const) {
      expect(locale[key]).toBeTruthy()
      expect(locale[`${key}Hint`]).toBeTruthy()
    }
  }
})
