// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { stateWithAgent, tupleA } from './managedClaudeResumeBindingFixtures'

describeWithElectronNativeModules('managed Claude ownership snapshot', () => {
  it('derives markers from the ledger, corrects first-save markers, and strips forgery without adoption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-ownership-'))
    const store = await createPersistenceStore({
      dbPath: join(root, 'state.db'),
      strictRecovery: true,
    })
    try {
      const forged = stateWithAgent()
      Object.assign(forged.workspaces[0].nodes[0], {
        managedClaudeResumeBindingOwnership: { activationId: 'forged', runtimeSessionId: 'old' },
      })
      expect(await store.writeAppState(forged)).toMatchObject({
        ok: true,
        corrected: true,
        revision: 1,
      })
      expect(store.observeManagedClaudeNode('agent').binding).toBeNull()
      expect((await store.readAppStateSnapshot())!.state).not.toHaveProperty(
        'workspaces.0.nodes.0.managedClaudeResumeBindingOwnership',
      )
      const activation = await store.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'activation',
        runtimeSessionId: 'old',
        tuple: tupleA,
      })
      expect(activation).toMatchObject({ status: 'committed', revision: 2 })
      const snapshot = await store.readAppStateSnapshot()
      expect(snapshot).toMatchObject({
        revision: 2,
        state: {
          workspaces: [
            {
              nodes: [
                {
                  managedClaudeResumeBindingOwnership: {
                    activationId: 'activation',
                    runtimeSessionId: 'old',
                  },
                },
              ],
            },
          ],
        },
      })
      expect(await store.writeAppState(stateWithAgent())).toMatchObject({
        ok: true,
        corrected: true,
        revision: 3,
      })
      expect(await store.writeAppState(snapshot!.state)).toMatchObject({
        ok: true,
        corrected: false,
        revision: 4,
      })
    } finally {
      store.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
