// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { admittedGrantInvocation } from './admittedGrantInvocation.testUtils'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { admitLaunchProvider } from '../../../src/app/main/controlSurface/handlers/agentLaunchEnvironment'
import { normalizeAgentSettings } from '../../../src/contexts/settings/domain/agentSettings'
import {
  sessionLaunchAgentOperation,
  sessionLaunchAgentInMountOperation,
} from '../../../src/shared/contracts/controlSurface/operations/domains/session'
import { nodeCreateOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/node'
import type {
  LaunchAgentSessionInput,
  LaunchAgentSessionInMountInput,
} from '../../../src/shared/contracts/dto'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

const base = createControlSurfaceHttpServerContext({
  enableWebShell: false,
  ptyProtocolVersion: 1,
  replayWindowMaxBytes: 10,
})
const { grant } = new SessionGrantRegistry(() => true).issue({
  projectId: 'project',
  spaceId: 'space',
  nodeId: 'caller',
  sessionId: 'caller-session',
})
const context = { ...base, requestAuth: { kind: 'session-grant' as const, grant } }
const overrides = [
  ['agentFullAccess', true],
  ['agentFullAccess', false],
  ['agentFullAccess', null],
  ['env', { KEY: 'override' }],
  ['env', null],
  ['executablePathOverride', '/custom/agent'],
  ['executablePathOverride', null],
  ['resumeSessionId', 'old'],
  ['resumeSessionId', null],
  ['codexReuseRunningAppServer', true],
  ['codexReuseRunningAppServer', false],
  ['mode', 'new'],
  ['mode', 'resume'],
  ['mode', null],
  ['futureOverride', true],
] as const

for (const operation of [sessionLaunchAgentOperation, sessionLaunchAgentInMountOperation]) {
  const target =
    operation.id === 'session.launchAgent'
      ? { cwd: '/repo' }
      : { mountId: 'mount', cwdUri: 'file:///repo' }
  function fixture() {
    const surface = createControlSurface()
    const spawn = vi.fn((payload: unknown) => payload)
    const handle = (
      ctx: ControlSurfaceContext,
      payload: LaunchAgentSessionInput | LaunchAgentSessionInMountInput,
    ) => {
      expect(ctx.requestAuth?.kind).toBe('session-grant')
      expect(ctx.agentSpawnPermit).toBeDefined()
      admitLaunchProvider(
        ctx,
        payload,
        normalizeAgentSettings({ defaultProvider: 'claude-code' }),
        'new',
      )
      return spawn(payload)
    }
    if (operation.id === 'session.launchAgent') {
      registerOperation(surface, operation, { handle, defaultErrorCode: 'agent.launch_failed' })
    } else {
      registerOperation(surface, operation, { handle, defaultErrorCode: 'agent.launch_failed' })
    }
    const invoke = (extra: object) =>
      admittedGrantInvocation(surface, context, {
        kind: 'command',
        id: operation.id,
        payload: { ...target, prompt: 'Explain this project', ...extra },
      })
    return { invoke, spawn }
  }
  it.each(overrides)(
    `${operation.id} preserves explicit %s=%j denial with a genuine internal permit`,
    async (field, value) => {
      const f = fixture()
      expect(await f.invoke({ [field]: value })).toMatchObject({
        ok: false,
        error: {
          code: 'common.forbidden',
          details: { reason: 'field_denied', field, operationId: operation.id },
        },
      })
      expect(f.spawn).not.toHaveBeenCalled()
    },
  )
  it.each(['logout', 'update', 'resume', 'Refactor'])(
    `${operation.id} preserves single-word %j denial with a genuine internal permit`,
    async prompt => {
      const f = fixture()
      expect(await f.invoke({ prompt: ` \t${prompt}\n ` })).toMatchObject({
        ok: false,
        error: {
          code: 'common.forbidden',
          details: {
            reason: 'field_denied',
            field: 'prompt',
            message: expect.stringContaining('describe the task in a sentence'),
          },
        },
      })
      expect(f.spawn).not.toHaveBeenCalled()
    },
  )
  it.each([
    '! printenv X',
    '/permissions change policy',
    '# note',
    '& task',
    '\u0085/permissions change policy',
  ])(
    `${operation.id} preserves resolved-provider command refusal for %j with a genuine internal permit`,
    async prompt => {
      const f = fixture()
      expect(await f.invoke({ provider: 'claude-code', prompt })).toMatchObject({
        ok: false,
        error: {
          code: 'common.forbidden',
          details: {
            reason: 'field_denied',
            promptReason: 'provider_command_prefix',
            message: expect.stringContaining('Describe the task in a sentence'),
          },
        },
      })
      expect(f.spawn).not.toHaveBeenCalled()
    },
  )
  it.each(['', 'Explain this project', '--continue the task'])(
    `${operation.id} admits normal input %j through the same permit boundary`,
    async prompt => {
      const f = fixture()
      expect(await f.invoke({ prompt })).toMatchObject({
        ok: true,
        value: {
          prompt,
          mode: 'new',
          agentFullAccess: null,
          env: null,
          executablePathOverride: null,
        },
      })
      expect(f.spawn).toHaveBeenCalledOnce()
    },
  )
}

for (const placement of ['root', 'data'] as const) {
  it.each(overrides)(
    `node.create rejects ${placement} override %s=%j before the node/launch handler`,
    async (field, value) => {
      const surface = createControlSurface()
      const handle = vi.fn()
      registerOperation(surface, nodeCreateOperation, {
        handle,
        defaultErrorCode: 'common.unexpected',
      })
      const data = {
        provider: 'claude-code',
        prompt: 'Explain this project',
        ...(placement === 'data' ? { [field]: value } : {}),
      }
      expect(
        await surface.invoke(context, {
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'agent',
            projectId: 'project',
            data,
            ...(placement === 'root' ? { [field]: value } : {}),
          },
        }),
      ).toMatchObject({
        ok: false,
        error: {
          code: 'common.invalid_input',
          details: {
            issues: expect.arrayContaining([
              expect.objectContaining({
                path: placement === 'data' ? ['data', field] : [field],
                code: 'unrecognized_keys',
              }),
            ]),
          },
        },
      })
      expect(handle).not.toHaveBeenCalled()
    },
  )
}
