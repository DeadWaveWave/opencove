/* eslint-disable no-await-in-loop -- Discovery and enforcement are compared in caller order. */
// @vitest-environment node
import { expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSystemHandlers } from '../../../src/app/main/controlSurface/handlers/systemHandlers'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import {
  sessionLaunchAgentOperation,
  sessionLaunchAgentInMountOperation,
} from '../../../src/shared/contracts/controlSurface/operations/domains/session'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { enSettingsPanel } from '../../../src/app/renderer/i18n/locales/en.settingsPanel'

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
const grantCtx = { ...base, requestAuth: { kind: 'session-grant' as const, grant } }
const fullAccessPath = [
  enSettingsPanel.title,
  enSettingsPanel.nav.agent,
  enSettingsPanel.navigation.providersTab,
  enSettingsPanel.groups.agent.permissions,
  enSettingsPanel.agent.fullAccessLabel,
].join(' → ')
const rejected = [
  'agentFullAccess',
  'env',
  'executablePathOverride',
  'resumeSessionId',
  'codexReuseRunningAppServer',
  'mode',
]
function fixture() {
  const surface = createControlSurface()
  registerSystemHandlers(surface, { appVersion: null })
  for (const id of ['session.writeNode', 'sync.writeState', 'sync.writeWorkspaceStateRaw']) {
    surface.register(id, {
      kind: 'command',
      validate: x => x,
      handle: () => null,
      defaultErrorCode: 'common.unexpected',
    })
  }
  for (const op of [sessionLaunchAgentOperation, sessionLaunchAgentInMountOperation]) {
    registerOperation(surface, op, { handle: () => null, defaultErrorCode: 'agent.launch_failed' })
  }
  const describe = (id: string, ctx = grantCtx) =>
    surface.invoke(ctx, { kind: 'query', id: 'system.operation.describe', payload: { id } })
  return { surface, describe }
}

it.each([
  ['system.ping', 'allowed'],
  ['session.writeNode', 'denied'],
  ['session.launchAgent', 'constrained'],
  ['session.launchAgentInMount', 'constrained'],
])('describes %s with the same grant access as the operation catalog', async (id, access) => {
  const f = fixture()
  const described = await f.describe(id)
  const catalog = await f.surface.invoke(grantCtx, {
    kind: 'query',
    id: 'system.operations',
    payload: {},
  })
  expect(described).toMatchObject({
    ok: true,
    value: { id, access, policyVersion: expect.any(String) },
  })
  if (!described.ok || !catalog.ok) {
    throw new Error('Discovery failed')
  }
  const value = described.value as {
    policyVersion: string
    reason?: string
    rejectedFields?: Record<string, string>
  }
  const list = catalog.value as {
    policyVersion: string
    operations: {
      id: string
      access: string
      reason?: string
      rejectedFields?: Record<string, string>
    }[]
  }
  const row = list.operations.find(op => op.id === id)!
  expect(value.policyVersion).toBe(list.policyVersion)
  expect(value.reason).toBe(row.reason)
  expect(value.rejectedFields).toEqual(row.rejectedFields)
  if (access === 'constrained') {
    expect(Object.keys(value.rejectedFields ?? {}).sort()).toEqual([...rejected].sort())
    expect(value.reason).toEqual(expect.any(String))
  }
})

it('never caches caller access with a schema or changes trusted describe envelopes', async () => {
  const f = fixture()
  const request = {
    kind: 'query' as const,
    id: 'system.operation.describe',
    payload: { id: 'session.launchAgent' },
  }
  expect(await f.surface.invoke(grantCtx, request)).toMatchObject({
    value: { access: 'constrained' },
  })
  const bearer = await f.surface.invoke({ ...base, requestAuth: { kind: 'bearer' } }, request)
  const cookie = await f.surface.invoke(
    { ...base, requestAuth: { kind: 'cookie', webSessionGeneration: 0 } },
    request,
  )
  expect(cookie).toEqual(bearer)
  for (const field of ['access', 'reason', 'policyVersion', 'rejectedFields']) {
    expect(bearer).not.toHaveProperty(`value.${field}`)
  }
  expect(
    await f.surface.invoke(
      { ...grantCtx, requestAuth: { kind: 'session-grant', grant: { ...grant, tier: 'read' } } },
      request,
    ),
  ).toMatchObject({
    value: { access: 'denied', reason: 'this credential permits read-only operations' },
  })
})

it.each([sessionLaunchAgentOperation, sessionLaunchAgentInMountOperation])(
  '$id lists the same field reasons it enforces',
  async op => {
    const f = fixture()
    const result = await f.describe(op.id)
    expect(result).toHaveProperty('value.rejectedFields')
    if (!result.ok) {
      throw new Error('Describe failed')
    }
    const fields = (result.value as { rejectedFields: Record<string, string> }).rejectedFields
    const target = op.id === 'session.launchAgent' ? { spaceId: 's' } : { mountId: 'm' }
    const values = {
      agentFullAccess: true,
      env: { KEY: 'fixture' },
      executablePathOverride: '/fixture/agent',
      resumeSessionId: 'old',
      codexReuseRunningAppServer: true,
      mode: 'new',
    }
    for (const [field, value] of Object.entries(values)) {
      expect(
        await f.surface.invoke(grantCtx, {
          kind: 'command',
          id: op.id,
          payload: { ...target, prompt: 'Hi', [field]: value },
        }),
      ).toMatchObject({
        ok: false,
        error: {
          code: 'common.forbidden',
          details: {
            reason: 'field_denied',
            field,
            message: `${op.id}.${field} is not available to agent terminals: ${fields[field]}.`,
          },
        },
      })
    }
  },
)

it('distinguishes message delivery from user-only permission prompts and dialogs', async () => {
  const f = fixture()
  expect(
    await f.surface.invoke(grantCtx, { kind: 'command', id: 'session.writeNode', payload: null }),
  ).toMatchObject({
    error: {
      details: {
        message:
          'session.writeNode is not available to agent terminals: send messages with opencove agent prompt; only the user can answer permission prompts and dialogs in OpenCove.',
      },
    },
  })
})
it.each(['sync.writeState', 'sync.writeWorkspaceStateRaw'])(
  '%s names the actual full-access Settings path in one sentence',
  async id => {
    const f = fixture()
    expect(await f.surface.invoke(grantCtx, { kind: 'command', id, payload: null })).toMatchObject({
      error: {
        details: {
          message: `${id} is not available to agent terminals: only the user can change settings; agent permissions are in ${fullAccessPath}.`,
        },
      },
    })
  },
)
it.each([sessionLaunchAgentOperation, sessionLaunchAgentInMountOperation])(
  '$id directs full-access changes to the user Settings control',
  async op => {
    const f = fixture(),
      target = op.id === 'session.launchAgent' ? { spaceId: 's' } : { mountId: 'm' }
    expect(
      await f.surface.invoke(grantCtx, {
        kind: 'command',
        id: op.id,
        payload: { ...target, prompt: 'Hi', agentFullAccess: true },
      }),
    ).toMatchObject({
      error: {
        details: {
          message: `${op.id}.agentFullAccess is not available to agent terminals: the user sets agent permissions in ${fullAccessPath}.`,
        },
      },
    })
  },
)
