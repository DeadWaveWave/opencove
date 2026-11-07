import { normalizeTerminalAgentActivityList } from '../../support/controlSurfaceLegacyOracles/terminalAgentActivityHandlers'
import { registerPluginDistributionHandlers } from '../../../src/app/main/controlSurface/handlers/pluginDistributionHandlers'
import { normalizeListSessionsPayload } from '../../support/controlSurfaceLegacyOracles/agentIpcValidation'
// @vitest-environment node
import { expect, it } from 'vitest'
import * as z from 'zod'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { registerControlSurfaceHandlers } from '../../../src/app/main/controlSurface/registerControlSurfaceHandlers'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { toAppErrorDescriptor } from '../../../src/shared/errors/appError'
import {
  normalizePluginViewOpen,
  normalizePluginViewClose,
  normalizePluginViewSetTitle,
  normalizePluginInvoke,
  normalizePluginStorageGet,
  normalizePluginStorageSet,
  normalizePluginPreferencesGet,
  normalizePluginPreferencesSet,
  normalizePluginViewPreferencesGet,
  normalizePluginViewPreferencesSet,
} from '../../support/controlSurfaceLegacyOracles/pluginViewAndPreferenceHandlers'
import {
  normalizePluginSidebar,
  normalizePluginHost,
  normalizePluginRepository,
} from '../../support/controlSurfaceLegacyOracles/pluginRequestHandlers'
import {
  normalizeSnapshotPayload,
  normalizePresentationSnapshotPayload,
  normalizeSpawnTerminalPayload,
  normalizePtySpawnPayload,
} from '../../support/controlSurfaceLegacyOracles/sessionStreamingPayloads'
import {
  normalizeAttachPayload,
  normalizeDetachPayload,
} from '../../support/controlSurfaceLegacyOracles/sessionAgentWatcherHandlers'
import { normalizeWorkspaceIdPayload } from '../../support/controlSurfaceLegacyOracles/sessionPrepareOrReviveShared'
import {
  normalizeStopNode,
  normalizeWriteNode,
} from '../../support/controlSurfaceLegacyOracles/sessionInputHandlers'
import { normalizeLaunchAgentInMountPayload } from '../../support/controlSurfaceLegacyOracles/sessionLaunchAgentInMountPayload'
const oracles: Record<string, (payload: unknown) => unknown> = {
  'session.terminalAgentActivity.list': normalizeTerminalAgentActivityList,
  'agent.listSessions': normalizeListSessionsPayload,
  'plugin.view.open': normalizePluginViewOpen,
  'plugin.view.close': normalizePluginViewClose,
  'plugin.view.setTitle': normalizePluginViewSetTitle,
  'plugin.invoke': normalizePluginInvoke,
  'plugin.storage.get': normalizePluginStorageGet,
  'plugin.storage.set': normalizePluginStorageSet,
  'plugin.preferences.get': normalizePluginPreferencesGet,
  'plugin.preferences.set': normalizePluginPreferencesSet,
  'plugin.view.preferences.get': normalizePluginViewPreferencesGet,
  'plugin.view.preferences.set': normalizePluginViewPreferencesSet,
  'session.snapshot': normalizeSnapshotPayload,
  'session.presentationSnapshot': normalizePresentationSnapshotPayload,
  'session.spawnTerminal': normalizeSpawnTerminalPayload,
  'pty.spawn': normalizePtySpawnPayload,
  'plugin.sidebar.items': normalizePluginSidebar,
  'plugin.host.request': normalizePluginHost,
  'plugin.repository.details': normalizePluginRepository,
  'session.attachAgentStateWatcher': normalizeAttachPayload,
  'session.detachAgentStateWatcher': normalizeDetachPayload,
  'session.stopNode': normalizeStopNode,
  'session.writeNode': normalizeWriteNode,
  'session.prepareOrRevive': normalizeWorkspaceIdPayload,
  'session.launchAgentInMount': normalizeLaunchAgentInMountPayload,
}
const bases: Record<string, Record<string, unknown>> = {
  'session.terminalAgentActivity.list': {},
  'agent.listSessions': { provider: 'codex', cwd: '/repo', limit: 20 },
  'plugin.view.open': {
    pluginId: 'v',
    nodeId: 'v',
    workspaceId: 'v',
    directoryPath: 'v',
    preview: true,
  },
  'plugin.view.close': { viewId: 'v' },
  'plugin.view.setTitle': { viewId: 'v', title: 'v' },
  'plugin.invoke': { viewId: 'v', method: 'v', params: true },
  'plugin.storage.get': { viewId: 'v', key: 'v', value: true },
  'plugin.storage.set': { viewId: 'v', key: 'v', value: true },
  'plugin.preferences.get': { pluginId: 'v' },
  'plugin.preferences.set': { pluginId: 'v', key: 'theme', value: 'dark' },
  'plugin.view.preferences.get': { viewId: 'v' },
  'plugin.view.preferences.set': { viewId: 'v', key: 'theme', value: 'dark' },
  'session.snapshot': { sessionId: 's' },
  'session.presentationSnapshot': { sessionId: 's' },
  'session.spawnTerminal': {
    spaceId: 'space-1',
    runtime: 'shell',
    command: 'echo',
    args: ['hi'],
    cols: 80,
    rows: 24,
  },
  'pty.spawn': {
    cwd: '/repo',
    workspaceId: 'w',
    profileId: 'default',
    shell: '/bin/sh',
    command: 'echo',
    args: ['hi'],
    env: { TERM: 'xterm' },
    cols: 80,
    rows: 24,
  },
  'plugin.sidebar.items': {
    pluginId: 'p',
    sectionId: 's',
    projectId: 'w',
    expectedRevision: 'r',
    expectedRuntimeGeneration: 1,
  },
  'plugin.host.request': { viewId: 'v', operation: 'canvas.list', payload: {} },
  'plugin.repository.details': { repository: 'owner/repo' },
  'session.attachAgentStateWatcher': {
    sessionId: 's',
    provider: 'claude-code',
    cwd: '/repo',
    launchMode: 'new',
    startedAtMs: 100,
    resumeSessionId: 'r',
  },
  'session.detachAgentStateWatcher': { sessionId: 's' },
  'session.stopNode': { nodeId: 'n', sessionId: 's' },
  'session.writeNode': { nodeId: 'n', sessionId: 's', data: 'ls\n' },
  'session.prepareOrRevive': { workspaceId: 'w', nodeIds: ['n'] },
  'session.launchAgentInMount': {
    mountId: 'm',
    cwdUri: 'file:///repo',
    prompt: 'hello',
    provider: 'claude-code',
    model: null,
    mode: 'new',
    resumeSessionId: null,
    agentFullAccess: true,
    env: {},
    executablePathOverride: null,
    cols: 80,
    rows: 24,
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
registerPluginDistributionHandlers(
  surface,
  {} as Parameters<typeof registerPluginDistributionHandlers>[1],
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
  const cases: unknown[] = [
    base,
    { ...base, extra: 1 },
    ...values,
    Object.assign([], base),
    JSON.parse(
      JSON.stringify({ ...base, marker: true }).replace('"marker":true', '"__proto__":true'),
    ),
  ]
  for (const key of Object.keys(base)) {
    const missing = { ...base }
    delete missing[key]
    cases.push(missing)
    for (const value of values) {
      cases.push({ ...base, [key]: value })
    }
  }
  it(id + ' exports strict JSON schema', () => {
    expect(
      attempt(validators[id], id === 'session.terminalAgentActivity.list' ? null : base, id).ok,
    ).toBe(true)
    const op = getControlSurfaceOperation(id)
    if (op?.contract !== 'schema') {
      throw new Error('Expected schema')
    }
    expect(() => z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' })).not.toThrow()
  })
  for (const [index, payload] of cases.entries()) {
    it(id + ' parity ' + index, () => {
      expect(attempt(validators[id], payload, id)).toStrictEqual(attempt(oracles[id], payload, id))
      const serialized = JSON.stringify(payload)
      if (serialized !== undefined) {
        const wire: unknown = JSON.parse(serialized)
        if (attempt(oracles[id], wire, id).ok) {
          const op = getControlSurfaceOperation(id)
          if (op?.contract !== 'schema') {
            throw new Error('Expected schema')
          }
          expect(op.input.safeParse(wire).success).toBe(true)
        }
      }
    })
  }
}
