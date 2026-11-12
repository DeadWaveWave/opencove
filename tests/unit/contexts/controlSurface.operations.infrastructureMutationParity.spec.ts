// @vitest-environment node
import { expect, it, vi } from 'vitest'
import * as z from 'zod'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerControlSurfaceHandlers } from '../../../src/app/main/controlSurface/registerControlSurfaceHandlers'
import { registerWorkerConfigurationHandlers } from '../../../src/app/worker/workerConfigurationHandlers'
import { registerManagedRuntimeHandlers } from '../../../src/app/main/controlSurface/handlers/managedRuntimeHandlers'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { toAppErrorDescriptor } from '../../../src/shared/errors/appError'
import * as authNormalize from '../../support/controlSurfaceLegacyOracles/authNormalize'
import * as managedSshNormalize from '../../support/controlSurfaceLegacyOracles/managedSshNormalize'
import * as integrationNormalize from '../../support/controlSurfaceLegacyOracles/integrationNormalize'
import * as syncStateNormalize from '../../support/controlSurfaceLegacyOracles/syncStateNormalize'
import * as workerMutationNormalize from '../../support/controlSurfaceLegacyOracles/workerMutationNormalize'
import * as managedRuntimeNormalize from '../../support/controlSurfaceLegacyOracles/managedRuntimeNormalize'
const oracles: Record<string, (payload: unknown) => unknown> = {
  'auth.issueWebSessionTicket': authNormalize.normalizeIssueTicketPayload,
  'endpoint.registerManagedSsh': managedSshNormalize.normalizeRegisterManagedSshEndpointPayload,
  'endpoint.updateManagedSsh': managedSshNormalize.normalizeUpdateManagedSshEndpointPayload,
  'endpoint.prepare': managedSshNormalize.normalizePrepareEndpointPayload,
  'endpoint.repair': managedSshNormalize.normalizeRepairEndpointPayload,
  'integration.github.resolvePullRequests':
    integrationNormalize.normalizeResolveGitHubPullRequestsPayload,
  'note.create': syncStateNormalize.normalizeCreateNotePayload,
  'sync.writeState': syncStateNormalize.normalizeWriteSyncStatePayload,
  'worker.config.set': workerMutationNormalize.normalizeSetConfig,
  'worker.webAccess.setSettings': workerMutationNormalize.normalizeSetSettings,
  'worker.webAccess.setSecurity': workerMutationNormalize.normalizeSetSecurity,
  'worker.maintenance.acquire': managedRuntimeNormalize.maintenanceOracle('instance-1'),
  'worker.maintenance.release': managedRuntimeNormalize.maintenanceOracle('instance-1'),
  'worker.maintenance.stop': managedRuntimeNormalize.maintenanceOracle('instance-1'),
  'worker.maintenance.activate': managedRuntimeNormalize.maintenanceOracle('instance-1'),
}
const bases: Record<string, Record<string, unknown>> = {
  'auth.issueWebSessionTicket': { redirectPath: ' /canvas ' },
  'endpoint.registerManagedSsh': {
    host: ' devbox ',
    displayName: 'Dev',
    port: 22,
    username: 'user',
    remotePort: 4310,
    remotePlatform: 'posix',
  },
  'endpoint.updateManagedSsh': {
    endpointId: 'remote-1',
    host: 'devbox',
    displayName: 'Dev',
    port: 22,
    username: 'user',
    remotePort: 4310,
    remotePlatform: 'windows',
  },
  'endpoint.prepare': {
    endpointId: 'remote-1',
    runtimeBuild: {
      schemaVersion: 1,
      buildId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      appVersion: '0.4.0',
      channel: 'dev',
      protocolVersion: 1,
      ptyProtocolVersion: 1,
      launchContractVersion: 1,
      dataSchemaVersion: 1,
    },
    reason: 'browse',
  },
  'endpoint.repair': {
    endpointId: 'remote-1',
    runtimeBuild: {
      schemaVersion: 1,
      buildId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      appVersion: '0.4.0',
      channel: 'dev',
      protocolVersion: 1,
      ptyProtocolVersion: 1,
      launchContractVersion: 1,
      dataSchemaVersion: 1,
    },
    action: 'retry',
  },
  'integration.github.resolvePullRequests': {
    repoPath: '/repo',
    branches: [' main ', 'feature', ''],
  },
  'note.create': {
    spaceId: 'space-1',
    title: ' Note ',
    text: ' hello ',
    x: 0,
    y: 1,
    width: 300,
    height: 200,
  },
  'sync.writeState': {
    state: { version: 1, workspaces: [] },
    baseRevision: 0,
    allowEmptyWorkspaceOverwrite: false,
  },
  'worker.config.set': { expectedUpdatedAt: null, value: { mode: 'local', remote: null } },
  'worker.webAccess.setSettings': { expectedUpdatedAt: null, value: { enabled: true, port: 0 } },
  'worker.webAccess.setSecurity': {
    expectedUpdatedAt: null,
    value: { exposeOnLan: false, password: null },
  },
  'worker.maintenance.acquire': { instanceId: 'instance-1', lease: 'lease-1' },
  'worker.maintenance.release': { instanceId: 'instance-1', lease: 'lease-1' },
  'worker.maintenance.stop': { instanceId: 'instance-1', lease: 'lease-1' },
  'worker.maintenance.activate': { instanceId: 'instance-1', lease: 'lease-1' },
}

const validators: Record<string, (payload: unknown) => unknown> = {}
const defaults: Record<string, Parameters<typeof toAppErrorDescriptor>[1]> = {}
const surface = {
  register(id, handler) {
    validators[id] = handler.validate
    defaults[id] = handler.defaultErrorCode
  },
} as ControlSurface
registerControlSurfaceHandlers(surface, {
  ptyRuntime: {},
  plugins: { configureHost() {} },
  ptyStreamHub: { agentRuns: { registry: { onDispose() {} } } },
} as Parameters<typeof registerControlSurfaceHandlers>[1])
registerWorkerConfigurationHandlers(
  surface,
  {} as Parameters<typeof registerWorkerConfigurationHandlers>[1],
)
registerManagedRuntimeHandlers(surface, { instanceId: 'instance-1' } as Parameters<
  typeof registerManagedRuntimeHandlers
>[1])
function attempt(parse: (payload: unknown) => unknown, payload: unknown, id: string) {
  try {
    return { ok: true, value: parse(payload) }
  } catch (error) {
    return { ok: false, error: toAppErrorDescriptor(error, defaults[id]) }
  }
}
const values: unknown[] = [
  undefined,
  null,
  false,
  true,
  0,
  -1,
  1.5,
  NaN,
  Infinity,
  '',
  ' ',
  '\t\n',
  '-flag',
  'x'.repeat(100000),
  [],
  {},
  ' hello ',
]
for (const [id, base] of Object.entries(bases)) {
  const cases: unknown[] = [
    base,
    { ...base, extra: 1 },
    ...values,
    Object.assign([], base),
    Object.assign([NaN, Infinity], base),
  ]
  for (const key of Object.keys(base)) {
    const missing = { ...base }
    delete missing[key]
    cases.push(missing)
    for (const value of values) {
      cases.push({ ...base, [key]: value })
    }
  }
  for (const key of ['value', 'runtimeBuild']) {
    const nested = base[key]
    if (nested && typeof nested === 'object') {
      for (const field of Object.keys(nested)) {
        for (const value of values) {
          cases.push({ ...base, [key]: { ...nested, [field]: value } })
        }
      }
    }
  }
  if (id === 'worker.config.set') {
    cases.push({
      expectedUpdatedAt: '2026-11-07T00:00:00.000Z',
      value: { mode: 'remote', remote: { hostname: ' host ', port: 4310, token: ' token ' } },
    })
    for (const remote of values) {
      cases.push({ ...base, value: { mode: 'local', remote } })
    }
  }
  if (id === 'integration.github.resolvePullRequests') {
    cases.push(
      { ...base, branches: Array.from({ length: 45 }, (_, i) => 'b' + i) },
      { ...base, branches: [null, 1, ' main ', '', {}, 'feature'] },
    )
  }
  if (id.startsWith('worker.maintenance.')) {
    cases.push(
      { ...base, instanceId: 'wrong' },
      { ...base, lease: 'x'.repeat(128) },
      { ...base, lease: 'x'.repeat(129) },
    )
  }
  it(id + ' exports its wire schema', () => {
    const op = getControlSurfaceOperation(id)
    expect(op?.contract).toBe('schema')
    if (op?.contract === 'schema') {
      expect(() =>
        z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' }),
      ).not.toThrow()
    }
  })
  for (const [index, payload] of cases.entries()) {
    it(id + ' parity ' + index, () => {
      expect(attempt(validators[id], payload, id)).toStrictEqual(attempt(oracles[id], payload, id))
      const json = JSON.stringify(payload)
      if (json !== undefined) {
        const wire: unknown = JSON.parse(json)
        if (attempt(oracles[id], wire, id).ok) {
          const op = getControlSurfaceOperation(id)
          if (op?.contract === 'schema') {
            expect(op.input.safeParse(wire).success).toBe(true)
          }
        }
      }
    })
  }
}
it.each(['acquire', 'release', 'activate', 'stop'])(
  'rejects wrong maintenance identity before %s side effects',
  async action => {
    const actual = createControlSurface()
    const mutation = vi.fn()
    const requestShutdown = vi.fn()
    registerManagedRuntimeHandlers(actual, {
      instanceId: 'instance-1',
      requestShutdown,
      maintenance: {
        acquire: mutation,
        release: mutation,
        activate: mutation,
        commitStop: mutation,
      } as unknown as Parameters<typeof registerManagedRuntimeHandlers>[1]['maintenance'],
    })
    const response = await actual.invoke(
      { now: () => new Date() } as Parameters<ControlSurface['invoke']>[0],
      {
        id: 'worker.maintenance.' + action,
        kind: 'command',
        payload: { instanceId: 'wrong', lease: 'lease-1' },
      },
    )
    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'common.unavailable',
        debugMessage: 'Error: Invalid maintenance target or lease.',
      },
    })
    expect(mutation).not.toHaveBeenCalled()
    expect(requestShutdown).not.toHaveBeenCalled()
  },
)

it('checks the sync revision before delegating opaque state validation to persistence', async () => {
  const { registerSyncHandlers } =
    await import('../../../src/app/main/controlSurface/handlers/syncHandlers')
  const actual = createControlSurface()
  const writeAppState = vi.fn()
  const store = {
    readAppStateRevision: async () => 7,
    writeAppState,
  } as unknown as Awaited<ReturnType<Parameters<typeof registerSyncHandlers>[1]>>
  registerSyncHandlers(actual, async () => store)
  const result = await actual.invoke(
    { now: () => new Date() } as Parameters<ControlSurface['invoke']>[0],
    { id: 'sync.writeState', kind: 'command', payload: { state: 42, baseRevision: 1 } },
  )
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'persistence.invalid_state',
      debugMessage: 'sync.writeState revision conflict (base=1, current=7)',
    },
  })
  expect(writeAppState).not.toHaveBeenCalled()
})
