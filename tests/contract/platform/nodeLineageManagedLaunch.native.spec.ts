// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { snapshotFixture, type SnapshotFixture } from './managedClaudeSnapshotFixture'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { withAgentRunBindings } from '../../../src/app/main/controlSurface/agentRunStatePersistence'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import type { CreateNodeResult } from '../../../src/shared/contracts/dto'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

describeWithElectronNativeModules('grant-created Claude lineage and managed ownership', () => {
  it.each([true, false])(
    'preserves both creation paths with adoption enabled=%s',
    async enabled => {
      const root = await mkdtemp(join(tmpdir(), 'opencove-lineage-launch-'))
      const registry = new AgentRunStateRegistry({
        epoch: 'lineage',
        now: () => 1,
        createTurnId: () => 'turn',
        schedule: () => () => {},
      })
      const bindings = new AgentRunStateRuntime(registry, () => 1)
      const beforeActivation: unknown[] = []
      const activate = vi.fn<NonNullable<PersistenceStore['activateManagedClaudeRuntime']>>()
      let f: SnapshotFixture | undefined
      try {
        f = await snapshotFixture(join(root, 'state.db'), null, false, 'launch', true, false, {
          adoptionEnabled: enabled,
          wrapStore: store => {
            const activation = store.activateManagedClaudeRuntime!
            activate.mockImplementation(input => {
              beforeActivation.push(store.observeManagedClaudeNode!(input.nodeId))
              return activation(input)
            })
            store.activateManagedClaudeRuntime = activate
            return withAgentRunBindings(async () => store, bindings)()
          },
        })
        const store = f.store
        const commits = vi.fn()
        store.onAppStateCommitted(commits)
        bindings.metadata({
          sessionId: 'runtime-1',
          resumeSessionId: 'new-conversation',
          agentProvider: 'claude-code',
        })
        const grant = new SessionGrantRegistry(() => true).issue({
          projectId: 'project',
          spaceId: 'space',
          nodeId: 'agent',
          sessionId: 'caller-runtime',
        }).grant
        const created = await f.invoke<CreateNodeResult>(
          {
            kind: 'command',
            id: 'node.create',
            payload: {
              kind: 'agent',
              space: { kind: 'spaceId', spaceId: 'space' },
              data: { provider: 'claude-code', prompt: 'Inspect this project' },
            },
          },
          { now: () => new Date(), requestAuth: { kind: 'session-grant', grant } },
        )
        const childId = created.node.id
        expect(created).toMatchObject({
          revision: 2,
          projectId: 'project',
          spaceId: 'space',
          node: {
            kind: 'agent',
            sessionId: 'runtime-1',
            spawnedBy: 'agent',
            lineageDepth: 2,
            lineageStatus: 'recorded',
          },
        })
        expect(f.spawn).toHaveBeenCalledTimes(1)
        expect(activate).toHaveBeenCalledTimes(enabled ? 1 : 0)
        if (enabled) {
          expect(beforeActivation).toEqual([
            expect.objectContaining({ binding: null, context: null, retired: false }),
          ])
          expect(store.observeManagedClaudeNode(childId).binding).toMatchObject({
            nodeSeen: true,
            runtimeSessionId: 'runtime-1',
            tuple: { resumeSessionId: 'new-conversation', resumeSessionIdVerified: true },
          })
          expect(await activate.mock.results[0].value).toEqual({ status: 'committed' })
        } else {
          expect(store.observeManagedClaudeNode(childId).binding).toBeNull()
        }
        expect((await store.nodeLineage!.readMany([childId])).get(childId)).toEqual({
          nodeId: childId,
          spawnedBy: 'agent',
          rootNodeId: 'agent',
          lineageDepth: 2,
        })
        expect(registry.get({ nodeId: childId })).toMatchObject({ sessionId: 'runtime-1' })
        const childGrant = new SessionGrantRegistry(() => true).issue({
          projectId: 'project',
          spaceId: 'space',
          nodeId: childId,
          sessionId: 'runtime-1',
        }).grant
        expect(
          await f.invoke(
            {
              kind: 'query',
              id: 'node.resolveCallerSelector',
              payload: { selector: '@parent', expectedCallerNodeId: childId },
            },
            { now: () => new Date(), requestAuth: { kind: 'session-grant', grant: childGrant } },
          ),
        ).toEqual({ kind: 'node', id: 'agent', callerNodeId: childId })
        expect(commits).toHaveBeenCalledExactlyOnceWith({
          revision: 2,
          removedNodeIds: [],
          removedRuntimeSessionIds: [],
          removedManagedRuntimeSessionIds: [],
        })
        await f.invoke({ kind: 'command', id: 'node.delete', payload: { nodeId: childId } })
        await vi.waitFor(() => expect(f!.alive.has('runtime-1')).toBe(false))
        if (enabled) {
          expect(store.observeManagedClaudeNode(childId).retired).toBe(true)
          expect(commits).toHaveBeenLastCalledWith({
            revision: 3,
            removedNodeIds: [childId],
            removedRuntimeSessionIds: ['runtime-1'],
            removedManagedRuntimeSessionIds: ['runtime-1'],
          })
        }
        expect(registry.get({ sessionId: 'runtime-1' })?.nodeId).toBeNull()
      } finally {
        f?.dispose()
        bindings.dispose()
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})
