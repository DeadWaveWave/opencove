// @vitest-environment node
import { expect, it } from 'vitest'
import * as z from 'zod'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { registerControlSurfaceHandlers } from '../../../src/app/main/controlSurface/registerControlSurfaceHandlers'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { toAppErrorDescriptor } from '../../../src/shared/errors/appError'
import * as filesystemMountReadHandlers from '../../support/controlSurfaceLegacyOracles/filesystemMountReadHandlersMigA'
import * as gitWorktreeMountWriteHandlers from '../../support/controlSurfaceLegacyOracles/gitWorktreeMountWriteHandlersMigA'
import * as filesystemHandlers from '../../support/controlSurfaceLegacyOracles/filesystemHandlersMigA'
import * as gitWorktreeHandlers from '../../support/controlSurfaceLegacyOracles/gitWorktreeHandlersMigA'
import * as filesystemMountWriteHandlers from '../../support/controlSurfaceLegacyOracles/filesystemMountWriteHandlersMigA'
import * as gitWorktreeMountReadHandlers from '../../support/controlSurfaceLegacyOracles/gitWorktreeMountReadHandlersMigA'
const oracles: Record<string, (payload: unknown) => unknown> = {
  'filesystem.readFileBytes': filesystemHandlers.normalizeFilesystemReadFileBytes,
  'filesystem.createDirectory': filesystemHandlers.normalizeFilesystemCreateDirectory,
  'filesystem.copyEntry': filesystemHandlers.normalizeFilesystemCopyEntry,
  'filesystem.moveEntry': filesystemHandlers.normalizeFilesystemMoveEntry,
  'filesystem.renameEntry': filesystemHandlers.normalizeFilesystemRenameEntry,
  'filesystem.deleteEntry': filesystemHandlers.normalizeFilesystemDeleteEntry,
  'filesystem.readFileBytesInMount':
    filesystemMountReadHandlers.normalizeFilesystemReadFileBytesInMount,
  'filesystem.createDirectoryInMount':
    filesystemMountWriteHandlers.normalizeFilesystemCreateDirectoryInMount,
  'filesystem.deleteEntryInMount':
    filesystemMountWriteHandlers.normalizeFilesystemDeleteEntryInMount,
  'filesystem.copyEntryInMount': filesystemMountWriteHandlers.normalizeFilesystemCopyEntryInMount,
  'filesystem.moveEntryInMount': filesystemMountWriteHandlers.normalizeFilesystemMoveEntryInMount,
  'filesystem.renameEntryInMount':
    filesystemMountWriteHandlers.normalizeFilesystemRenameEntryInMount,
  'gitWorktree.listBranches': gitWorktreeHandlers.normalizeGitWorktreeListBranches,
  'gitWorktree.listWorktrees': gitWorktreeHandlers.normalizeGitWorktreeListWorktrees,
  'gitWorktree.statusSummary': gitWorktreeHandlers.normalizeGitWorktreeStatusSummary,
  'gitWorktree.graph': gitWorktreeHandlers.normalizeGitWorktreeGraph,
  'gitWorktree.getDefaultBranch': gitWorktreeHandlers.normalizeGitWorktreeGetDefaultBranch,
  'gitWorktree.create': gitWorktreeHandlers.normalizeGitWorktreeCreate,
  'gitWorktree.remove': gitWorktreeHandlers.normalizeGitWorktreeRemove,
  'gitWorktree.renameBranch': gitWorktreeHandlers.normalizeGitWorktreeRenameBranch,
  'gitWorktree.suggestNames': gitWorktreeHandlers.normalizeGitWorktreeSuggestNames,
  'gitWorktree.listBranchesInMount':
    gitWorktreeMountReadHandlers.normalizeGitWorktreeListBranchesInMount,
  'gitWorktree.listWorktreesInMount':
    gitWorktreeMountReadHandlers.normalizeGitWorktreeListWorktreesInMount,
  'gitWorktree.statusSummaryInMount':
    gitWorktreeMountReadHandlers.normalizeGitWorktreeStatusSummaryInMount,
  'gitWorktree.getDefaultBranchInMount':
    gitWorktreeMountReadHandlers.normalizeGitWorktreeGetDefaultBranchInMount,
  'gitWorktree.graphInMount': gitWorktreeMountReadHandlers.normalizeGitWorktreeGraphInMount,
  'gitWorktree.createInMount': gitWorktreeMountWriteHandlers.normalizeGitWorktreeCreateInMount,
  'gitWorktree.removeInMount': gitWorktreeMountWriteHandlers.normalizeGitWorktreeRemoveInMount,
  'gitWorktree.renameBranchInMount':
    gitWorktreeMountWriteHandlers.normalizeGitWorktreeRenameBranchInMount,
}
const validators: Record<string, (payload: unknown) => unknown> = {}
const defaults: Record<string, Parameters<typeof toAppErrorDescriptor>[1]> = {}
registerControlSurfaceHandlers(
  {
    register(id, handler) {
      validators[id] = handler.validate
      defaults[id] = handler.defaultErrorCode
    },
  } as ControlSurface,
  {
    ptyRuntime: {},
    plugins: { configureHost() {} },
    ptyStreamHub: { agentRuns: { registry: { onDispose() {} } } },
  } as Parameters<typeof registerControlSurfaceHandlers>[1],
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
const fixtures: Record<string, unknown> = {
  uri: 'file:///tmp/repo/a.txt',
  sourceUri: 'file:///tmp/repo/a.txt',
  targetUri: 'file:///tmp/repo/b.txt',
  mountId: 'mount-1',
  recursive: true,
  repoPath: '/tmp/repo',
  worktreesRoot: '/tmp/worktrees',
  worktreesRootUri: 'file:///tmp/repo/worktrees',
  worktreePath: '/tmp/worktrees/feature',
  worktreeUri: 'file:///tmp/repo/worktrees/feature',
  branchMode: { kind: 'new', name: 'feature/test', startPoint: 'main' },
  force: false,
  deleteBranch: true,
  currentName: 'feature/old',
  nextName: 'feature/new',
  limit: 50,
  provider: 'codex',
  cwd: '/tmp/repo',
  spaceName: 'Feature',
  spaceNotes: 'Implement feature',
  model: '',
  tasks: [{ title: 'Task', requirement: 'Add coverage' }],
}
for (const [id, oracle] of Object.entries(oracles)) {
  const operation = getControlSurfaceOperation(id)
  if (operation?.contract !== 'schema') {
    throw new Error('Expected schema: ' + id)
  }
  const schema = z.toJSONSchema(operation.input, { io: 'input', unrepresentable: 'throw' })
  const objectSchema = schema.anyOf ? schema.anyOf[0] : schema
  const keys = Object.keys(objectSchema.properties ?? {})
  const base = Object.fromEntries(keys.map(key => [key, fixtures[key]]))
  const cases: unknown[] = [base, { ...base, extra: 1 }, ...values, Object.assign([], base)]
  // Existing handler fixtures: controlSurface.worktreeHandlers.spec.ts:254 and
  // controlSurfaceHttpServer.multiEndpoint.controlPlane.spec.ts:234.
  if (id === 'gitWorktree.createInMount') {
    cases.push({
      mountId: 'mount-1',
      worktreesRootUri: 'file:///repo/.opencove/worktrees',
      branchMode: { kind: 'existing', name: 'feature-a' },
    })
  }
  if (id === 'filesystem.readFileBytesInMount') {
    cases.push({ mountId: 'mount-1', uri: 'file:///tmp/image.png' })
  }

  for (const key of keys) {
    const missing = { ...base }
    delete missing[key]
    cases.push(missing)
    for (const value of values) {
      cases.push({ ...base, [key]: value })
    }
  }
  if ('branchMode' in base) {
    cases.push({ ...base, branchMode: { kind: ' existing ', name: ' main ', startPoint: 123 } })
    for (const key of ['kind', 'name', 'startPoint']) {
      for (const value of values) {
        cases.push({
          ...base,
          branchMode: { kind: 'new', name: 'feature', startPoint: 'main', [key]: value },
        })
      }
    }
  }
  if ('uri' in base) {
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
  // Parse raw wire text directly: stringify would turn numeric overflow into null.
  const rawValues = [
    ['positive overflow', '1e400'],
    ['negative overflow', '-1e400'],
    ['deep arrays', '['.repeat(3000) + '0' + ']'.repeat(3000)],
    ['deep objects', '{"nested":'.repeat(3000) + '0' + '}'.repeat(3000)],
  ] as const
  function expectRawParity(raw: string) {
    const wire: unknown = JSON.parse(raw)
    const expected = attempt(oracle, wire, id)
    expect(attempt(validators[id], wire, id)).toStrictEqual(expected)
    if (expected.ok) {
      expect(operation.input.safeParse(wire).success).toBe(true)
    }
  }
  for (const [label, raw] of rawValues) {
    for (const key of keys) {
      it(`${id} raw parity ${key}: ${label}`, () => {
        const fields = Object.entries(base)
          .filter(([name]) => name !== key)
          .map(([name, value]) => `${JSON.stringify(name)}:${JSON.stringify(value)}`)
        expectRawParity(`{${[...fields, `${JSON.stringify(key)}:${raw}`].join(',')}}`)
      })
    }
    it(`${id} raw parity top-level array: ${label}`, () => {
      expectRawParity(`[${raw}]`)
    })
    if ('branchMode' in base) {
      for (const kind of ['existing', 'new']) {
        it(`${id} raw parity ${kind} branch startPoint: ${label}`, () => {
          const { branchMode: _branchMode, ...rest } = base
          expectRawParity(
            JSON.stringify(rest).slice(0, -1) +
              `,"branchMode":{"kind":"${kind}","name":"feature","startPoint":${raw}}}`,
          )
        })
      }
    }
    if ('tasks' in base) {
      it(`${id} raw parity ignored task fields: ${label}`, () => {
        const { tasks: _tasks, ...rest } = base
        expectRawParity(
          JSON.stringify(rest).slice(0, -1) +
            `,"tasks":[{"title":${raw},"requirement":${raw}},{"title":"keep"}]}`,
        )
      })
    }
  }
  it(id + ' exports a field-level schema', () => {
    expect(keys.length).toBeGreaterThan(0)
  })
  for (const [index, payload] of cases.entries()) {
    it(id + ' parity ' + index, () => {
      // Compare raw in-process inputs through both pure and registered validators.
      expect(attempt(operation.normalize, payload, id)).toStrictEqual(attempt(oracle, payload, id))
      expect(attempt(validators[id], payload, id)).toStrictEqual(attempt(oracle, payload, id))
      // Transport inputs must pass through the actual composition registration.
      const json = JSON.stringify(payload)
      if (json !== undefined) {
        const wire: unknown = JSON.parse(json)
        const expected = attempt(oracle, wire, id)
        expect(attempt(validators[id], wire, id)).toStrictEqual(expected)
        if (expected.ok) {
          expect(operation.input.safeParse(wire).success).toBe(true)
        }
      }
    })
  }
}
