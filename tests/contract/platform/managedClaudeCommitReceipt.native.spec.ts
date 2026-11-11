// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { ManagedClaudeLaunchPorts } from '../../../src/contexts/agent/application/managedClaudeLaunch/ports'
import { stateWithAgent, tupleA, tupleB } from './managedClaudeResumeBindingFixtures'

describeWithElectronNativeModules('managed Claude exact commit receipts', () => {
  let root: string
  let store: Awaited<ReturnType<typeof createPersistenceStore>>
  let owner: ManagedClaudeLaunchOwner
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-commit-receipt-'))
    store = await createPersistenceStore({ dbPath: join(root, 'state.db'), strictRecovery: true })
  })
  afterEach(async () => {
    owner?.dispose()
    store?.dispose()
    await rm(root, { recursive: true, force: true })
  })
  async function writeUnrelated() {
    const state = normalizePersistedAppState(await store.readAppState())!
    state.workspaces[0].name = 'Unrelated workspace edit'
    await store.writeAppState(state)
  }
  async function seed(owned: boolean, persisted = true, runtimeSessionId: string | null = 'old') {
    const state = stateWithAgent()
    if (!persisted) {
      state.workspaces[0].nodes = []
    }
    await store.writeAppState(state)
    if (owned) {
      await store.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'initial',
        runtimeSessionId,
        tuple: tupleA,
      })
    }
  }
  function launchOwner(
    activate: ManagedClaudeLaunchPorts['activateManagedClaudeRuntime'],
    id = 'operation',
  ) {
    const publish = vi.fn()
    owner = new ManagedClaudeLaunchOwner({
      observeNode: store.observeManagedClaudeNode,
      isRuntimeReferenced: store.isManagedClaudeRuntimeReferenced,
      activateManagedClaudeRuntime: activate,
      createId: () => id,
      killExactRuntime: async () => {},
      publishCommittedActivation: publish,
    })
    return publish
  }
  function reserve() {
    const observation = store.observeManagedClaudeNode('agent')
    const attempt = owner.reserve('agent')
    attempt.context = observation.context
    attempt.expected = {
      activationId: observation.binding?.activationId ?? null,
      tuple: observation.binding?.tuple ?? {
        resumeSessionId: null,
        resumeSessionIdVerified: false,
      },
    }
    return attempt
  }
  const execution = { provider: 'claude-code', cwd: '/repo', mountId: null }

  it.each(
    ['activation', 'settlement'].flatMap(kind =>
      ['committed', 'unknown', 'retry'].map(outcome => ({ kind, outcome })),
    ),
  )(
    'retains the exact $kind revision after $outcome and a later write',
    async ({ kind, outcome }) => {
      const settlement = kind === 'settlement'
      await seed(settlement)
      const originalRevision = settlement ? 2 : 1
      const activate = vi.fn<ManagedClaudeLaunchPorts['activateManagedClaudeRuntime']>(
        async input => {
          if (outcome === 'retry' && activate.mock.calls.length === 1) {
            return { status: 'retryableFailure', outcome: 'notCommitted' }
          }
          const result = await store.activateManagedClaudeRuntime(input)
          // The confirmation now observes a newer global revision than this operation committed.
          await writeUnrelated()
          return outcome === 'unknown' ? { status: 'retryableFailure', outcome: 'unknown' } : result
        },
      )
      const publish = launchOwner(activate)
      const attempt = reserve()
      await owner.admit(attempt, execution)
      const receipt = settlement
        ? await owner.fail(attempt)
        : await owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: tupleB })
      expect(receipt).toMatchObject({
        commitRevision: originalRevision + 1,
        binding: {
          activationId: 'operation',
          bindingRevision: originalRevision + 1,
          observedRevision: originalRevision + 2,
        },
      })
      expect(await store.readAppStateRevision()).toBe(originalRevision + 2)
      expect(activate).toHaveBeenCalledTimes(outcome === 'retry' ? 2 : 1)
      expect(publish).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ revision: originalRevision + 1 }),
      )
      if (settlement) {
        expect((await owner.fail(attempt))?.commitRevision).toBe(originalRevision + 1)
        const next = reserve()
        await owner.admit(next, execution)
        expect((await owner.fail(next))?.commitRevision).toBeNull()
        expect(publish).toHaveBeenCalledTimes(1)
      }
    },
  )

  it.each(
    ['activation', 'settlement'].flatMap(kind =>
      ['committed', 'unknown'].map(outcome => ({ kind, outcome })),
    ),
  )(
    'keeps row-only $kind unattributed after $outcome and an unrelated app commit',
    async ({ kind, outcome }) => {
      const settlement = kind === 'settlement'
      await seed(settlement, false)
      const publish = launchOwner(async input => {
        const result = await store.activateManagedClaudeRuntime(input)
        await writeUnrelated()
        return outcome === 'unknown' ? { status: 'retryableFailure', outcome: 'unknown' } : result
      })
      const attempt = reserve()
      await owner.admit(attempt, execution)
      const receipt = settlement
        ? await owner.fail(attempt)
        : await owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: tupleB })
      expect(receipt).toMatchObject({
        commitRevision: null,
        binding: { nodeSeen: false, bindingRevision: 1, observedRevision: 2 },
      })
      expect(await store.readAppStateRevision()).toBe(2)
      expect(publish).not.toHaveBeenCalled()
    },
  )

  it.each(
    [false, true].flatMap(persisted =>
      [null, 'old'].map(runtimeSessionId => ({ persisted, runtimeSessionId })),
    ),
  )(
    'does not relabel alreadyApplied observation as a commit, persisted=$persisted / runtime=$runtimeSessionId',
    async ({ persisted, runtimeSessionId }) => {
      await seed(true, persisted, runtimeSessionId)
      await writeUnrelated()
      const currentRevision = persisted ? 3 : 2
      const duplicate = {
        nodeId: 'agent',
        activationId: 'initial',
        runtimeSessionId,
        tuple: tupleA,
      }
      expect(await store.activateManagedClaudeRuntime(duplicate)).toMatchObject({
        status: 'alreadyApplied',
        revision: currentRevision,
      })
      const publish = launchOwner(store.activateManagedClaudeRuntime, 'initial')
      const receipt = await owner.complete(reserve(), { runtimeSessionId, tuple: tupleA })
      expect(receipt).toMatchObject({
        commitRevision: null,
        binding: { bindingRevision: persisted ? 2 : 1, observedRevision: currentRevision },
      })
      expect(await store.readAppStateRevision()).toBe(currentRevision)
      expect(publish).not.toHaveBeenCalled()
    },
  )

  it.each([false, true])('preserves rebind revision attribution, persisted=%s', async persisted => {
    await seed(true, persisted)
    const input = {
      nodeId: 'agent',
      activationId: 'rebind',
      runtimeSessionId: 'old',
      expected: tupleA,
      next: tupleB,
    }
    const committed = await store.commitManagedClaudeRebind(input)
    await writeUnrelated()
    if (persisted) {
      expect(committed).toMatchObject({ status: 'committed', revision: 3 })
    } else {
      expect(committed).toEqual({ status: 'committed' })
    }
    expect(store.observeManagedClaudeNode('agent').binding).toMatchObject({
      bindingRevision: persisted ? 3 : 1,
      observedRevision: persisted ? 4 : 2,
      tuple: tupleB,
    })
    const duplicate = await store.commitManagedClaudeRebind(input)
    expect(duplicate).toMatchObject({ status: 'alreadyApplied', revision: persisted ? 4 : 2 })
    expect(await store.readAppStateRevision()).toBe(persisted ? 4 : 2)
  })
})
