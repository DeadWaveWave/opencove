import { admittedGrantInvocation } from './admittedGrantInvocation.testUtils'
/* eslint-disable no-await-in-loop -- Each request observes the preceding mutation or authorization boundary. */
// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { CONTROL_SURFACE_OPERATIONS } from '../../../src/shared/contracts/controlSurface/operations'
import { SESSION_GRANT_POLICY } from '../../../src/app/main/controlSurface/http/sessionGrantPolicy'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import {
  sessionLaunchAgentOperation,
  sessionLaunchAgentInMountOperation,
} from '../../../src/shared/contracts/controlSurface/operations/domains/session'
import { registerSystemHandlers } from '../../../src/app/main/controlSurface/handlers/systemHandlers'
import { toMountedAgentLaunchInput } from '../../../src/app/main/controlSurface/handlers/sessionLaunchPayloadSupport'
import { REQUIRED_SESSION_GRANT_DENIALS } from './sessionGrantPolicy.expectations'
function registerLaunch(
  surface: ControlSurface,
  op: typeof sessionLaunchAgentOperation | typeof sessionLaunchAgentInMountOperation,
  handle: (ctx: ControlSurfaceContext, payload: unknown) => unknown,
) {
  if (op.id === 'session.launchAgent') {
    registerOperation(surface, op, { handle, defaultErrorCode: 'agent.launch_failed' })
  } else {
    registerOperation(surface, op, { handle, defaultErrorCode: 'agent.launch_failed' })
  }
}
const base = createControlSurfaceHttpServerContext({
  enableWebShell: false,
  ptyProtocolVersion: 1,
  replayWindowMaxBytes: 10,
})
const { grant } = new SessionGrantRegistry(() => true).issue({
  projectId: 'p',
  spaceId: 's',
  nodeId: 'n',
  sessionId: 'session',
})
const ctx = { ...base, requestAuth: { kind: 'session-grant' as const, grant } }
it('classifies every registered operation explicitly and preserves the admin ceiling', () => {
  expect(Object.keys(SESSION_GRANT_POLICY).sort()).toEqual(
    CONTROL_SURFACE_OPERATIONS.map(op => op.id).sort(),
  )
  for (const op of REQUIRED_SESSION_GRANT_DENIALS) {
    expect(SESSION_GRANT_POLICY[op.id].access, op.id).toBe('deny')
  }
  for (const op of CONTROL_SURFACE_OPERATIONS) {
    if (op.scope === 'admin' || op.id.startsWith('auth.') || op.id.startsWith('worker.')) {
      expect(SESSION_GRANT_POLICY[op.id].access).toBe('deny')
    }
  }
})
it.each(REQUIRED_SESSION_GRANT_DENIALS)(
  'denies $id before validation as required by S1a',
  async op => {
    expect(SESSION_GRANT_POLICY[op.id].access, op.id).toBe('deny')
    const surface = createControlSurface()
    const validate = vi.fn(x => x),
      handle = vi.fn(() => ({ secret: 'never' }))
    surface.register(op.id, {
      kind: op.kind,
      validate,
      handle,
      defaultErrorCode: 'common.unexpected',
    })
    const request = { id: op.id, kind: op.kind, payload: {} }
    expect(await surface.invoke(ctx, request)).toMatchObject({
      ok: false,
      error: {
        code: 'common.forbidden',
        details: { reason: 'operation_denied', operationId: op.id, message: expect.any(String) },
      },
    })
    expect(validate).not.toHaveBeenCalled()
    expect(handle).not.toHaveBeenCalled()
    // The same request still has its full envelope under desktop and web credentials.
    for (const auth of [
      { kind: 'bearer' as const },
      { kind: 'cookie' as const, webSessionGeneration: 0 },
    ]) {
      expect(await surface.invoke({ ...base, requestAuth: auth }, request)).toEqual({
        __opencoveControlEnvelope: true,
        ok: true,
        value: { secret: 'never' },
      })
    }
  },
)
for (const op of [sessionLaunchAgentOperation, sessionLaunchAgentInMountOperation]) {
  const target = op.id === 'session.launchAgent' ? { spaceId: 's' } : { mountId: 'm' }
  it.each([
    'env',
    'executablePathOverride',
    'resumeSessionId',
    'codexReuseRunningAppServer',
    'mode',
    'futureOverride',
  ])(`${op.id} refuses explicit %s before launch`, async field => {
    const surface = createControlSurface(),
      handle = vi.fn(() => ({ sessionId: 'started' }))
    registerLaunch(surface, op, handle)
    const value: Record<string, unknown> = {
      env: { KEY: 'secret' },
      executablePathOverride: '/bin/sh',
      resumeSessionId: 'old',
      codexReuseRunningAppServer: true,
      mode: 'new',
      futureOverride: true,
    }
    const result = await surface.invoke(ctx, {
      id: op.id,
      kind: 'command',
      payload: { ...target, prompt: 'Hi', [field]: value[field] },
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'common.forbidden', details: { reason: 'field_denied', field } },
    })
    expect(handle).not.toHaveBeenCalled()
  })
  it.each([true, false])(`${op.id} allows explicit Full Access=%s`, async agentFullAccess => {
    const surface = createControlSurface()
    registerLaunch(surface, op, (_ctx, payload) => payload)
    expect(
      await admittedGrantInvocation(surface, ctx, {
        id: op.id,
        kind: 'command',
        payload: { ...target, prompt: 'Explain this project', agentFullAccess },
      }),
    ).toMatchObject({ ok: true, value: { agentFullAccess } })
  })
  it(`${op.id} refuses target fields belonging to the other launch operation`, async () => {
    const surface = createControlSurface(),
      handle = vi.fn()
    registerLaunch(surface, op, handle)
    const field = op.id === 'session.launchAgent' ? 'mountId' : 'spaceId'
    expect(
      await surface.invoke(ctx, {
        id: op.id,
        kind: 'command',
        payload: { ...target, prompt: 'Hi', [field]: 'other' },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'common.forbidden', details: { reason: 'field_denied', field } },
    })
    expect(handle).not.toHaveBeenCalled()
  })
  it.each([
    ['env', null],
    ['executablePathOverride', null],
    ['resumeSessionId', null],
    ['codexReuseRunningAppServer', false],
    ['mode', null],
  ] as const)(`${op.id} refuses an explicitly supplied %s=%s`, async (field, value) => {
    const surface = createControlSurface(),
      handle = vi.fn()
    registerLaunch(surface, op, handle)
    expect(
      await surface.invoke(ctx, {
        id: op.id,
        kind: 'command',
        payload: { ...target, prompt: 'Hi', [field]: value },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'common.forbidden', details: { reason: 'field_denied', field } },
    })
    expect(handle).not.toHaveBeenCalled()
  })
  it(`${op.id} admits normalizer defaults and never changes bearer/cookie payloads`, async () => {
    const surface = createControlSurface(),
      handle = vi.fn((_ctx, payload) => payload)
    registerLaunch(surface, op, handle)
    const payload = {
      ...target,
      prompt: 'Explain this project',
      provider: 'codex',
      model: 'test',
      cols: 80,
      rows: 24,
    }
    expect(
      await admittedGrantInvocation(surface, ctx, { id: op.id, kind: 'command', payload }),
    ).toMatchObject({
      ok: true,
      value: { mode: 'new', agentFullAccess: null, env: null },
    })
    for (const auth of [
      { kind: 'bearer' as const },
      { kind: 'cookie' as const, webSessionGeneration: 0 },
    ]) {
      expect(
        await surface.invoke(
          { ...base, requestAuth: auth },
          { id: op.id, kind: 'command', payload: { ...payload, agentFullAccess: true } },
        ),
      ).toMatchObject({ ok: true, value: { agentFullAccess: true } })
    }
  })
}
for (const op of [sessionLaunchAgentOperation, sessionLaunchAgentInMountOperation]) {
  for (const auth of [
    { kind: 'bearer' as const },
    { kind: 'cookie' as const, webSessionGeneration: 0 },
  ]) {
    it.each(['logout', 'update', 'resume', 'Refactor'])(
      `${op.id}/${auth.kind} preserves trusted single-token %j admission`,
      async prompt => {
        const surface = createControlSurface()
        const handle = vi.fn((_ctx, payload) => payload)
        registerLaunch(surface, op, handle)
        const payload = {
          ...(op.id === 'session.launchAgent' ? { cwd: '/fixture' } : { mountId: 'mount' }),
          prompt,
        }
        expect(
          await surface.invoke(
            { ...base, requestAuth: auth },
            { id: op.id, kind: 'command', payload },
          ),
        ).toMatchObject({ ok: true, value: { prompt } })
        expect(handle).toHaveBeenCalledOnce()
      },
    )
  }
}
it('reports policy access and the real read tier without affecting bearer metadata', async () => {
  const surface = createControlSurface()
  registerSystemHandlers(surface, { appVersion: null })
  surface.register('session.writeNode', {
    kind: 'command',
    validate: x => x,
    handle: () => {},
    defaultErrorCode: 'common.unexpected',
  })
  registerOperation(surface, sessionLaunchAgentOperation, {
    handle: () => ({ sessionId: 'started' }),
    defaultErrorCode: 'agent.launch_failed',
  })
  const readCtx = {
    ...ctx,
    requestAuth: { kind: 'session-grant' as const, grant: { ...grant, tier: 'read' as const } },
  }
  expect(
    await surface.invoke(readCtx, { id: 'system.whoami', kind: 'query', payload: {} }),
  ).toMatchObject({ ok: true, value: { scopeTier: 'read' } })
  expect(
    await surface.invoke(ctx, { id: 'system.operations', kind: 'query', payload: {} }),
  ).toMatchObject({
    ok: true,
    value: {
      policyVersion: expect.any(String),
      operations: expect.arrayContaining([
        {
          id: 'session.writeNode',
          kind: 'command',
          scope: 'interact',
          availability: 'always',
          contract: 'schema',
          summary: expect.any(String),
          access: 'denied',
          reason: expect.any(String),
        },
        expect.objectContaining({ id: 'system.ping', access: 'allowed' }),
        expect.objectContaining({ id: 'session.launchAgent', access: 'constrained' }),
      ]),
    },
  })
  const request = { id: 'system.operations', kind: 'query' as const, payload: {} }
  const bearer = await surface.invoke({ ...base, requestAuth: { kind: 'bearer' } }, request)
  expect(bearer).not.toHaveProperty('value.policyVersion')
  expect(
    await surface.invoke(
      { ...base, requestAuth: { kind: 'cookie', webSessionGeneration: 0 } },
      request,
    ),
  ).toEqual(bearer)
  expect(await surface.invoke(ctx, { id: 'toString', kind: 'query', payload: {} })).toMatchObject({
    ok: false,
    error: { code: 'common.forbidden' },
  })
})

it.each([{ kind: 'bearer' as const }, { kind: 'cookie' as const, webSessionGeneration: 0 }])(
  'preserves all trusted $kind launch overrides during mount forwarding',
  auth => {
    const payload = {
      prompt: 'Resume',
      provider: 'codex' as const,
      model: 'test',
      mode: 'resume' as const,
      resumeSessionId: 'old',
      env: { KEY: 'value' },
      executablePathOverride: '/custom/agent',
      agentFullAccess: true,
      codexReuseRunningAppServer: true,
      cols: 80,
      rows: 24,
    }
    const target = { mountId: 'mount', cwdUri: 'file:///workspace' }
    expect(toMountedAgentLaunchInput(payload, target, auth)).toEqual({ ...target, ...payload })
  },
)
it('forwards admitted grant input without explicit normalized launch overrides', () => {
  const payload = {
    spaceId: 's',
    prompt: 'Hi',
    mode: 'new' as const,
    agentFullAccess: null,
    env: null,
  }
  expect(
    toMountedAgentLaunchInput(payload, { mountId: 'mount', cwdUri: null }, ctx.requestAuth),
  ).toEqual({
    mountId: 'mount',
    cwdUri: null,
    prompt: 'Hi',
    provider: null,
    model: null,
    cols: undefined,
    rows: undefined,
  })
})

it.each(['read', 'interact'] as const)(
  'applies the %s tier ceiling to every policy entry',
  async tier => {
    const { sessionGrantAccess } =
      await import('../../../src/app/main/controlSurface/http/sessionGrantAuthorization')
    for (const op of CONTROL_SURFACE_OPERATIONS) {
      const access = sessionGrantAccess(op.id, tier).access
      if (op.scope === 'admin' || (tier === 'read' && op.scope !== 'read')) {
        expect(access, op.id).toBe('denied')
      }
    }
  },
)

it.each([true, false])(
  'preserves admitted grant Full Access=%s during mount forwarding',
  agentFullAccess => {
    expect(
      toMountedAgentLaunchInput(
        { prompt: '', agentFullAccess },
        { mountId: 'mount', cwdUri: null },
        ctx.requestAuth,
      ),
    ).toMatchObject({ agentFullAccess })
  },
)

it.each([true, false])(
  'preserves explicit Full Access=%s when resolving Home launch settings',
  async agentFullAccess => {
    const { resolveRemoteAgentLaunchSettings } =
      await import('../../../src/app/main/controlSurface/handlers/agentLaunchEnvironment')
    const { createMinimalState } =
      await import('./controlSurfaceHttpServer.sessionStreaming.testUtils')
    const state = createMinimalState('/repo', 'p', 's')
    state.settings = { agentFullAccess: !agentFullAccess }
    const result = await resolveRemoteAgentLaunchSettings(
      ctx,
      { mountId: 'm', prompt: 'Explain this project', agentFullAccess },
      { getPersistenceStore: async () => ({ readAppState: async () => state }) as never },
    )
    expect(result.agentFullAccess).toBe(agentFullAccess)
    expect(state.settings).toEqual({ agentFullAccess: !agentFullAccess })
  },
)
