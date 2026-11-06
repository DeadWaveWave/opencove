// @vitest-environment node
import { expect, it } from 'vitest'
import * as z from 'zod'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerControlSurfaceHandlers } from '../../../src/app/main/controlSurface/registerControlSurfaceHandlers'
import { registerWorkerConfigurationHandlers } from '../../../src/app/worker/workerConfigurationHandlers'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { toAppErrorDescriptor } from '../../../src/shared/errors/appError'
import * as integrationMountNormalize from '../../support/controlSurfaceLegacyOracles/integrationMountNormalize'
import * as spaceCreateChildNormalize from '../../support/controlSurfaceLegacyOracles/spaceCreateChildNormalize'
import * as syncScrollbackNormalize from '../../support/controlSurfaceLegacyOracles/syncScrollbackNormalize'
import * as topologyBrowseNormalize from '../../support/controlSurfaceLegacyOracles/topologyBrowseNormalize'
import * as workerConfigurationNormalize from '../../support/controlSurfaceLegacyOracles/workerConfigurationNormalize'
import * as workspaceNormalize from '../../support/controlSurfaceLegacyOracles/workspaceNormalize'
const oracles: Record<string, (payload: unknown) => unknown> = {
  'endpoint.homeDirectory': topologyBrowseNormalize.normalizeEndpointHomeDirectoryPayload,
  'endpoint.readDirectory': topologyBrowseNormalize.normalizeEndpointReadDirectoryPayload,
  'endpoint.sshConfigHosts': topologyBrowseNormalize.normalizeSshConfigHostsPayload,
  'mount.promote': topologyBrowseNormalize.normalizePromoteMountPayload,
  'sync.state': syncScrollbackNormalize.normalizeSyncStatePayload,
  'sync.readWorkspaceStateRaw': syncScrollbackNormalize.normalizeReadWorkspaceStateRawPayload,
  'sync.writeWorkspaceStateRaw': syncScrollbackNormalize.normalizeWriteWorkspaceStateRawPayload,
  'sync.readNodeScrollback': syncScrollbackNormalize.normalizeReadNodeScrollbackPayload,
  'sync.writeNodeScrollback': syncScrollbackNormalize.normalizeWriteNodeScrollbackPayload,
  'sync.readAgentNodePlaceholderScrollback':
    syncScrollbackNormalize.normalizeReadAgentNodePlaceholderScrollbackPayload,
  'sync.writeAgentNodePlaceholderScrollback':
    syncScrollbackNormalize.normalizeWriteAgentNodePlaceholderScrollbackPayload,
  'workspace.approveRoot': (payload: unknown) =>
    workspaceNormalize.normalizePathPayload(payload, 'workspace.approveRoot'),
  'workspace.ensureDirectory': (payload: unknown) =>
    workspaceNormalize.normalizePathPayload(payload, 'workspace.ensureDirectory'),
  'workspace.allocateProjectPlaceholder':
    workspaceNormalize.normalizeAllocateProjectPlaceholderPayload,
  'space.createChild': spaceCreateChildNormalize.normalizeCreateChildPayload,
  'worker.config.get': workerConfigurationNormalize.requireNullPayload,

  'integration.github.resolvePullRequestsInMount':
    integrationMountNormalize.normalizeResolveInMount,
}
const bases: Record<string, unknown> = {
  'endpoint.homeDirectory': { endpointId: ' remote-1 ' },
  'endpoint.readDirectory': { endpointId: 'remote-1', path: '/repo' },
  'endpoint.sshConfigHosts': null,
  'mount.promote': { mountId: ' mount-1 ' },
  'sync.state': null,
  'sync.readWorkspaceStateRaw': null,
  'sync.writeWorkspaceStateRaw': { raw: '{"workspaces":[]}' },
  'space.createChild': {
    parentSpaceId: 'space-1',
    projectId: 'project-1',
    name: ' Child ',
    initialNodeIds: ['n1', ' n1 ', ''],
    rect: { x: 0, y: 0, width: 400, height: 300 },
    anchor: { x: 0, y: 0 },
  },
  'workspace.approveRoot': { path: '/repo' },
  'workspace.ensureDirectory': { path: '/repo/child' },
  'workspace.allocateProjectPlaceholder': { projectId: 'project-1' },
  'worker.config.get': null,

  'integration.github.resolvePullRequestsInMount': {
    mountId: 'mount-1',
    branches: [' main ', 'feature/test', ''],
  },
  'sync.readNodeScrollback': { nodeId: ' node-1 ' },
  'sync.writeNodeScrollback': { nodeId: ' node-1 ', scrollback: 'terminal output\r\n' },
  'sync.readAgentNodePlaceholderScrollback': { nodeId: ' node-1 ' },
  'sync.writeAgentNodePlaceholderScrollback': {
    nodeId: ' node-1 ',
    scrollback: 'terminal output\r\n',
  },
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
  ptyStreamHub: {},
} as Parameters<typeof registerControlSurfaceHandlers>[1])
registerWorkerConfigurationHandlers(
  surface,
  {} as Parameters<typeof registerWorkerConfigurationHandlers>[1],
)
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
  const realistic: Record<string, unknown[]> = {
    // tests/unit/contexts/controlSurface.spaceHandlers.spec.ts:172
    'space.createChild': [
      { parentSpaceId: 'parent-space', initialNodeIds: ['agent-1', 'terminal-1'] },
    ],
    // tests/unit/contexts/controlSurface.topologyHandlers.spec.ts:249
    'endpoint.homeDirectory': [{ endpointId: 'remote' }],
  }
  const cases: unknown[] = [base, ...values, ...(realistic[id] ?? [])]
  if (base && typeof base === 'object') {
    cases.push({ ...base, extra: 1 }, Object.assign([], base), Object.assign([NaN, Infinity], base))
    for (const key of Object.keys(base)) {
      const missing = { ...base } as Record<string, unknown>
      delete missing[key]
      cases.push(missing)
      for (const value of values) {
        cases.push({ ...base, [key]: value })
      }
    }
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
