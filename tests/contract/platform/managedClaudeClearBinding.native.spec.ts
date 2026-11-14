// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import { stateWithAgent, tupleA } from './managedClaudeResumeBindingFixtures'

describeWithElectronNativeModules('owner-qualified Claude clear commits', () => {
  let root: string,
    store: Awaited<ReturnType<typeof createPersistenceStore>>,
    owner: ManagedClaudeLaunchOwner
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-clear-binding-'))
    store = await createPersistenceStore({ dbPath: join(root, 'state.db'), strictRecovery: true })
    await store.writeAppState(stateWithAgent())
  })
  afterEach(async () => {
    owner?.dispose()
    store?.dispose()
    await rm(root, { recursive: true, force: true })
  })
  it.each(['committed', 'unknown', 'notCommitted'] as const)(
    'preserves durable predecessor and unrelated edits after %s',
    async outcome => {
      let sequence = 0,
        fail = true
      const commits: string[] = []
      store.onAppStateCommitted(event => {
        if (event.operationId === 'managedClaude.resumeBinding.commit') {
          commits.push(event.operationId)
        }
      })
      owner = new ManagedClaudeLaunchOwner({
        observeNode: store.observeManagedClaudeNode,
        isRuntimeReferenced: store.isManagedClaudeRuntimeReferenced,
        activateManagedClaudeRuntime: store.activateManagedClaudeRuntime,
        commitManagedClaudeRebind: async input => {
          if (fail && outcome === 'notCommitted') {
            fail = false
            return { status: 'retryableFailure', outcome: 'notCommitted' }
          }
          const result = await store.commitManagedClaudeRebind(input)
          if (fail && outcome === 'unknown') {
            fail = false
            throw new Error('result lost')
          }
          return result
        },
        createId: () => `id-${++sequence}`,
        killExactRuntime: async () => {},
        publishCommittedActivation: () => {},
      })
      const attempt = owner.reserve('agent')
      await owner.complete(attempt, { runtimeSessionId: 'runtime', tuple: tupleA })
      const admission = owner.qualification.openInvocation('runtime', {}, () => true)!
      for (const [ordinal, id] of [
        [1, 'B'],
        [2, 'C'],
      ] as const) {
        const identity = {
          occurrenceId: `occ-${ordinal}`,
          ordinal,
          resumeSessionId: id,
          promptId: `p-${id}`,
        }
        await owner.qualification
          .beginQualification(admission, identity)!
          .submit({ ...identity, evidenceId: 'proof' })
      }
      expect(await owner.qualification.drain({ deadlineAt: performance.now() + 200 })).toEqual({
        status: 'drained',
      })
      const row = store.observeManagedClaudeNode('agent').binding!
      expect(row.tuple.resumeSessionId).toBe('C')
      expect(row.runtimeSessionId).toBe('runtime')
      const stale = stateWithAgent()
      stale.workspaces[0].name = 'Unrelated edit'
      await store.writeAppState(stale)
      const state = normalizePersistedAppState(await store.readAppState())!
      expect(state.workspaces[0].name).toBe('Unrelated edit')
      expect(state.workspaces[0].nodes[0].agent).toMatchObject({
        resumeSessionId: 'C',
        model: 'old',
      })
      expect(commits).toHaveLength(outcome === 'notCommitted' ? 1 : 2)
    },
  )
})
