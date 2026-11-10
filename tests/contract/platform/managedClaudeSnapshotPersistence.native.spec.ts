// @vitest-environment happy-dom
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { registerPersistenceIpcHandlers } from '../../../src/platform/persistence/sqlite/ipc/register'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { invokeHandledIpc } from '../ipc/ipcTestUtils'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import type { LaunchAgentSessionResult } from '../../../src/shared/contracts/dto'
import type { PersistedAppState } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  routes,
  operations,
  snapshotFixture,
  type SnapshotFixture,
  type Operation,
} from './managedClaudeSnapshotFixture'
import { rendererSnapshot, persistRendererSnapshot } from './managedClaudeSnapshotRenderer'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))
vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))
vi.mock('../../../src/platform/terminal/TerminalProfileResolver', () => ({
  TerminalProfileResolver: class {
    async resolveTerminalSpawn(input: { cwd: string }) {
      return {
        cwd: input.cwd,
        command: '/bin/sh',
        args: [],
        env: {},
        profileId: null,
        runtimeKind: 'posix',
      }
    }
  },
}))
function fallback(operation: Operation) {
  return operation.endsWith('Fallback')
}
const cases = routes.flatMap(route =>
  [false, true].flatMap(owned =>
    operations
      .filter(operation => (fallback(operation) ? owned : !owned || operation !== 'prepareBlank'))
      .flatMap(operation =>
        (fallback(operation) ? [false, true] : [false]).flatMap(preSettled =>
          [false, true].map(stale => ({
            route: route.name,
            binding: route.binding,
            inheritedMount: route.inheritedMount,
            owned,
            operation,
            preSettled,
            stale,
          })),
        ),
      ),
  ),
)
function identity(node: {
  kind: string
  workerBinding?: unknown
  executionDirectory?: unknown
  agent?: unknown
}) {
  const agent = node.agent as {
    provider: string
    executionDirectory: string
    expectedDirectory: string
  }
  return {
    kind: node.kind,
    provider: agent.provider,
    route: node.workerBinding,
    directory: node.executionDirectory,
    agentDirectory: agent.executionDirectory,
    expectedDirectory: agent.expectedDirectory,
  }
}

describeWithElectronNativeModules('managed Claude lifecycle renderer snapshot round trip', () => {
  let root: string, f: SnapshotFixture, ipc: ReturnType<typeof registerPersistenceIpcHandlers>
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-snapshot-roundtrip-'))
  })
  afterEach(async () => {
    ipc?.dispose()
    f?.dispose()
    handlers.clear()
    await rm(root, { recursive: true, force: true })
  })
  async function setup(
    binding: (typeof routes)[number]['binding'],
    owned: boolean,
    operation: Operation,
    inheritedMount = false,
    preSettled = false,
  ) {
    f = await snapshotFixture(
      join(root, 'state.db'),
      binding,
      owned,
      operation,
      inheritedMount,
      preSettled,
    )
    ipc = registerPersistenceIpcHandlers(async () => f.store)
    const write = vi.fn(async (payload: unknown) =>
      invokeHandledIpc(handlers.get(IPC_CHANNELS.persistenceWriteAppState), null, payload),
    )
    window.opencoveApi = {
      controlSurface: { invoke: f.invoke },
      agent: {
        launch: async (payload: object) => f.launch(payload) as Promise<LaunchAgentSessionResult>,
      },
      pty: { kill: vi.fn(async () => {}) },
      persistence: { writeAppState: write },
    } as unknown as typeof window.opencoveApi
    return write
  }
  it.each(cases)(
    '$route / owned=$owned / $operation / preSettled=$preSettled / correction=$stale',
    async test => {
      const write = await setup(
        test.binding,
        test.owned,
        test.operation,
        test.inheritedMount,
        test.preSettled,
      )
      const originalIdentity = identity(f.state.workspaces[0].nodes[0])
      const { snapshot, nodes, binding, receipt, prepared } = await rendererSnapshot(
        f,
        test.operation,
      )
      expect(binding?.nodeSeen).toBe(true)
      expect(binding?.tuple).toEqual({
        resumeSessionId:
          ['launch', 'prepareResume'].includes(test.operation) || fallback(test.operation)
            ? 'initial-conversation'
            : test.operation === 'switch'
              ? 'selected-conversation'
              : 'new-conversation',
        resumeSessionIdVerified: true,
      })
      expect(receipt).toBeDefined()
      expect(receipt!.commitRevision).toBe(f.publications.at(-1)?.revision ?? null)
      expect(receipt!.binding.activationId).toBe(binding!.activationId)
      expect(f.alive.has(nodes[0].data.sessionId)).toBe(true)
      if (fallback(test.operation)) {
        expect(prepared?.recoveryState).toBe('fallback_terminal')
        expect(binding!.runtimeSessionId).toBeNull()
        expect(f.publications).toHaveLength(test.preSettled ? 0 : 1)
        expect(await f.store.readAppStateRevision()).toBe(
          f.initialRevision + (test.preSettled ? 0 : 1),
        )
        expect(receipt!.commitRevision).toBe(test.preSettled ? null : f.initialRevision + 1)
      } else {
        expect(nodes[0].data.lastError).toBeNull()
        expect(binding!.runtimeSessionId).toBe(nodes[0].data.sessionId)
        expect(receipt!.commitRevision).toBe(await f.store.readAppStateRevision())
      }
      const expected = structuredClone(snapshot)
      if (test.stale) {
        if (!fallback(test.operation)) {
          snapshot.workspaces[0].nodes[0].sessionId = 'stale-runtime'
        }
        Object.assign(snapshot.workspaces[0].nodes[0].agent!, {
          resumeSessionId: 'stale',
          resumeSessionIdVerified: false,
        })
      }
      const revision = await f.store.readAppStateRevision()
      const written = await persistRendererSnapshot(f, snapshot)
      // This invokes the actual renderer write port, handled IPC and SQLite final writer/gate.
      expect(written).toMatchObject({ ok: true, corrected: test.stale })
      expect(write).toHaveBeenCalledTimes(1)
      expect(await f.store.readAppStateRevision()).toBe(revision + 1)
      expect(identity(snapshot.workspaces[0].nodes[0])).toEqual(originalIdentity)
      const durable = normalizePersistedAppState(await f.store.readAppState())!
      expect(identity(durable.workspaces[0].nodes[0])).toEqual(originalIdentity)
      const payload = write.mock.calls[0][0] as { state: PersistedAppState }
      const normalized = normalizePersistedAppState(payload.state)!
      Object.assign(normalized.workspaces[0].nodes[0], {
        sessionId: binding!.runtimeSessionId ?? snapshot.workspaces[0].nodes[0].sessionId,
      })
      Object.assign(normalized.workspaces[0].nodes[0].agent!, binding!.tuple)
      expect(durable).toEqual(normalized)
      expect(durable.workspaces[0].nodes[0].agent).toMatchObject(
        expected.workspaces[0].nodes[0].agent!,
      )
    },
  )
  it.each(
    routes.flatMap(route =>
      ['workerBinding', 'agent.provider', 'kind'].map(field => ({ ...route, field })),
    ),
  )('keeps the real $field identity guard for $name', async test => {
    await setup(test.binding, true, 'relaunch', test.inheritedMount)
    const { snapshot } = await rendererSnapshot(f, 'relaunch')
    if (test.field === 'workerBinding') {
      snapshot.workspaces[0].nodes[0].workerBinding = test.binding
        ? null
        : { endpointId: 'local', mountId: null }
    }
    if (test.field === 'agent.provider') {
      snapshot.workspaces[0].nodes[0].agent!.provider = 'codex'
    }
    if (test.field === 'kind') {
      snapshot.workspaces[0].nodes[0].kind = 'terminal'
    }
    expect(await persistRendererSnapshot(f, snapshot)).toMatchObject({
      ok: false,
      error: { code: 'persistence.owned_node_identity_conflict', details: { field: test.field } },
    })
  })
})
