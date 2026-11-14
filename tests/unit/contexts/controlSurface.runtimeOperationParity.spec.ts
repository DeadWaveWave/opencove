// @compat-file control-surface-legacy-validation
// @vitest-environment node
import { expect, it } from 'vitest'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { registerControlSurfaceHandlers } from '../../../src/app/main/controlSurface/registerControlSurfaceHandlers'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { toAppErrorDescriptor } from '../../../src/shared/errors/appError'
import {
  normalizeEndpointList,
  normalizeEndpointRegister,
  normalizeEndpointRemove,
  normalizeEndpointPing,
  normalizeMountList,
  normalizeMountCreate,
  normalizeMountRemove,
  normalizeMountTargetResolve,
} from '../../support/controlSurfaceLegacyOracles/topologyHandlers'
import {
  normalizeFilesystemReadFileText,
  normalizeFilesystemStat,
  normalizeFilesystemReadDirectory,
} from '../../support/controlSurfaceLegacyOracles/filesystemHandlers'
import {
  normalizeFilesystemReadFileTextInMount,
  normalizeFilesystemStatInMount,
  normalizeFilesystemReadDirectoryInMount,
} from '../../support/controlSurfaceLegacyOracles/filesystemMountReadHandlers'
import { normalizeFilesystemWriteFileTextInMount } from '../../support/controlSurfaceLegacyOracles/filesystemMountWriteHandlers'
import { normalizePtySpawnInMount } from '../../support/controlSurfaceLegacyOracles/ptyMountHandlers'
import {
  normalizeSystemPing,
  normalizeSystemCapabilities,
} from '../../support/controlSurfaceLegacyOracles/systemHandlers'
const oracles: Record<string, (payload: unknown) => unknown> = {
  'endpoint.list': normalizeEndpointList,
  'endpoint.register': normalizeEndpointRegister,
  'endpoint.remove': normalizeEndpointRemove,
  'endpoint.ping': normalizeEndpointPing,
  'mount.list': normalizeMountList,
  'mount.create': normalizeMountCreate,
  'mount.remove': normalizeMountRemove,
  'mountTarget.resolve': normalizeMountTargetResolve,
  'filesystem.readFileText': normalizeFilesystemReadFileText,
  'filesystem.stat': normalizeFilesystemStat,
  'filesystem.readDirectory': normalizeFilesystemReadDirectory,
  'filesystem.readFileTextInMount': normalizeFilesystemReadFileTextInMount,
  'filesystem.statInMount': normalizeFilesystemStatInMount,
  'filesystem.readDirectoryInMount': normalizeFilesystemReadDirectoryInMount,
  'filesystem.writeFileTextInMount': normalizeFilesystemWriteFileTextInMount,
  'pty.spawnInMount': normalizePtySpawnInMount,
  'system.ping': normalizeSystemPing,
  'system.capabilities': normalizeSystemCapabilities,
}
const bases: Record<string, Record<string, unknown>> = {
  'endpoint.list': {},
  'endpoint.ping': { endpointId: ' remote-1 ', timeoutMs: 2500 },
  'endpoint.register': {
    hostname: ' 127.0.0.1 ',
    port: 4300,
    token: ' token ',
    displayName: 'Remote',
  },
  'endpoint.remove': { endpointId: 'remote-1', expectedMountCount: 0 },
  'mount.create': { projectId: 'project-1', endpointId: 'local', rootPath: '/repo', name: 'Repo' },
  'mount.list': { projectId: 'project-1' },
  'mount.remove': { mountId: 'mount-1' },
  'mountTarget.resolve': { mountId: 'mount-1' },
  'pty.spawnInMount': {
    mountId: 'mount-1',
    cwdUri: 'file:///repo',
    profileId: 'default',
    shell: '/bin/sh',
    command: 'echo',
    args: ['hello'],
    cols: 80,
    rows: 24,
    env: { TERM: 'xterm' },
  },
  'system.ping': {},
  'system.capabilities': {},
  'filesystem.readFileText': { uri: 'file:///tmp/file.txt', maxBytes: 1024 },
  'filesystem.stat': { uri: 'file:///tmp/file.txt' },
  'filesystem.readDirectory': { uri: 'file:///tmp/file.txt', maxEntries: 100 },
  'filesystem.readFileTextInMount': {
    uri: 'file:///tmp/file.txt',
    mountId: 'mount-1',
    maxBytes: 1024,
  },
  'filesystem.statInMount': { uri: 'file:///tmp/file.txt', mountId: 'mount-1' },
  'filesystem.readDirectoryInMount': {
    uri: 'file:///tmp/file.txt',
    mountId: 'mount-1',
    maxEntries: 100,
  },
  'filesystem.writeFileTextInMount': {
    uri: 'file:///tmp/file.txt',
    mountId: 'mount-1',
    content: 'hello',
    overwrite: true,
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
  ptyStreamHub: { agentRuns: { registry: { onDispose() {} } } },
} as Parameters<typeof registerControlSurfaceHandlers>[1])
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
  // Payload forms from controlSurfaceHttpServer.multiEndpoint.controlPlane.spec.ts:134,243.
  const realistic: Record<string, unknown[]> = {
    'endpoint.register': [{ hostname: '127.0.0.1', port: 1234, token: 'SECRET_TOKEN_DO_NOT_LEAK' }],
    'pty.spawnInMount': [{ mountId: 'mount-1', cols: 80, rows: 24 }],
  }
  const cases = [
    ...(realistic[id] ?? []),
    base,
    { ...base, extra: 1 },
    ...values,
    Object.assign([], base),
  ]
  for (const key of Object.keys(base)) {
    const missing = { ...base }
    delete missing[key]
    cases.push(missing)
    for (const value of values) {
      cases.push({ ...base, [key]: value })
    }
  }
  if (id.startsWith('filesystem.')) {
    for (const uri of [
      ' file:///tmp/a ',
      'file:relative',
      'FILE:///tmp/a',
      'https://example.com',
      'file://host/a',
      'file:///a%ZZ',
      '-file:///a',
    ]) {
      cases.push({ ...base, uri })
    }
  }
  if (id === 'pty.spawnInMount') {
    for (const env of [
      { ' A ': 'v', OPENCOVE_X: 'x', BAD: 1 },
      { ['A'.repeat(257)]: 'x' },
      { A: 'x'.repeat(32769) },
      Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['K' + i, 'v'])),
    ]) {
      cases.push({ ...base, env })
    }
  }
  for (const [index, payload] of cases.entries()) {
    it(id + ' parity ' + index, () => {
      expect(attempt(validators[id], payload, id)).toStrictEqual(attempt(oracles[id], payload, id))
      // The compatibility fallback must not hide a schema that rejects valid JSON wire inputs.
      const serialized = JSON.stringify(payload)
      if (serialized !== undefined) {
        const wire: unknown = JSON.parse(serialized)
        if (attempt(oracles[id], wire, id).ok) {
          const operation = getControlSurfaceOperation(id)
          if (operation?.contract !== 'schema') {
            throw new Error('Expected schema operation')
          }
          expect(operation.input.safeParse(wire).success).toBe(true)
        }
      }
    })
  }
}
