import { expect, it } from 'vitest'
import { posix, win32 } from 'node:path'
import { toFileUri, fromFileUri } from '../../../src/contexts/filesystem/domain/fileUri'
import { AgentSpawnAdmissionOwner } from '../../../src/contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { ResolvedNodeCreationTarget } from '../../../src/contexts/workspace/application/nodeControl/nodeCreationTarget'

function fixture(paths: typeof win32) {
  const owner = new AgentSpawnAdmissionOwner(
    {
      snapshot: () => ({ revision: 1, bindings: [] }),
      isCurrent: () => true,
    },
    paths,
  )
  const store = {
    readAppState: async () => ({
      workspaces: [{ nodes: [{ id: 'root', kind: 'terminal', sessionId: 'shell' }] }],
    }),
    readAppStateRevision: async () => 1,
    isAppStateRevisionCurrent: () => true,
    nodeLineage: { readMany: async () => new Map(), readAll: async () => new Map() },
    commitCreatedNodeState: async () => {},
  } as unknown as NodeControlAppStateStore
  const target = {
    endpoint: { kind: 'local', endpointId: 'local' },
    workspace: { id: 'p' },
    workingDirectory: '/repo',
  } as ResolvedNodeCreationTarget
  const input = (nodeId: string) => ({
    nodeId,
    kind: 'terminal' as const,
    authority: { grantId: 'g', nodeId: 'root', sessionId: 'shell' },
    target,
    assertActive: () => {},
  })
  return { owner, store, target, input }
}

it.each([
  'C:/repo/with spaces',
  'C:\\repo\\with spaces',
  '//server/share/repo',
  '//SERVER/share/repo',
  '//server/share/repo/',
  '//SERVER/share/',
  '\\\\server\\share\\repo',
])('accepts Windows file-URI slash normalization with explicit win32 semantics: %s', async cwd => {
  const f = fixture(win32)
  const target = { ...f.target, workingDirectory: cwd }
  await f.owner.runCreation(f.store, { ...f.input('child'), target }, async permit => {
    const executed = fromFileUri(toFileUri(cwd))!
    expect(() => f.owner.assertExecution(permit, { cwd: executed })).not.toThrow()
    expect(() =>
      f.owner.assertTarget(permit, { ...target, workingDirectory: executed }),
    ).not.toThrow()
    expect(() =>
      f.owner.assertExecution(permit, { cwd: win32.join(executed, 'different') }),
    ).toThrow()
  })
})

it.each([
  ['c:/repo/', 'C:\\repo'],
  ['C:/', 'c:\\'],
  ['//SERVER/share/repo/', '\\\\server\\share\\repo'],
  ['//SERVER/share/', '\\\\server\\share'],
])('canonicalizes both Windows fence operands: %s -> %s', async (cwd, executed) => {
  const f = fixture(win32)
  const target = { ...f.target, workingDirectory: cwd }
  await f.owner.runCreation(f.store, { ...f.input('child'), target }, async permit => {
    expect(() => f.owner.assertExecution(permit, { cwd: executed })).not.toThrow()
    expect(() =>
      f.owner.assertTarget(permit, { ...target, workingDirectory: executed }),
    ).not.toThrow()
  })
})

it('keeps POSIX literal backslashes distinct with explicit posix semantics', async () => {
  const f = fixture(posix)
  const target = { ...f.target, workingDirectory: '/repo/literal\\name' }
  await f.owner.runCreation(f.store, { ...f.input('child'), target }, async permit => {
    expect(() => f.owner.assertExecution(permit, { cwd: '/repo/literal/name' })).toThrow()
    expect(() =>
      f.owner.assertTarget(permit, { ...target, workingDirectory: '/repo/literal/name' }),
    ).toThrow()
  })
})

it.each([
  ['C:/', 'C:'],
  ['C:/repo', 'D:/repo'],
  ['//server/share/repo', '//other/share/repo'],
  ['//server/share/repo', '//server/other/repo'],
  ['//server/share/Repo', '//server/share/repo'],
])('keeps distinct Windows directory identities fenced: %s -> %s', async (cwd, executed) => {
  const f = fixture(win32)
  const target = { ...f.target, workingDirectory: cwd }
  await f.owner.runCreation(f.store, { ...f.input('child'), target }, async permit => {
    expect(() => f.owner.assertExecution(permit, { cwd: executed })).toThrow()
    expect(() => f.owner.assertTarget(permit, { ...target, workingDirectory: executed })).toThrow()
  })
})
