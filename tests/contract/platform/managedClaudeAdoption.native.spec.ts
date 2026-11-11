// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { stateWithAgent, tupleA, tupleB } from './managedClaudeResumeBindingFixtures'

describeWithElectronNativeModules('first Claude adoption CAS and crash recovery', () => {
  let root: string, dbPath: string
  let store: Awaited<ReturnType<typeof createPersistenceStore>>
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-adoption-'))
    dbPath = join(root, 'state.db')
    store = await createPersistenceStore({ dbPath, strictRecovery: true })
    await store.writeAppState(stateWithAgent())
  })
  afterEach(async () => {
    store?.dispose()
    await rm(root, { recursive: true, force: true })
  })
  function candidate() {
    return {
      nodeId: 'agent',
      activationId: 'adopt',
      runtimeSessionId: 'spawned-A',
      tuple: tupleA,
      expected: {
        activationId: null,
        tuple: { resumeSessionId: null, resumeSessionIdVerified: false },
      },
      adoptionSnapshot: store.observeManagedClaudeNode('agent').adoptionSnapshot,
    }
  }
  async function reopen() {
    store.dispose()
    store = await createPersistenceStore({ dbPath, strictRecovery: true })
    return store.observeManagedClaudeNode('agent')
  }
  it.each(['tuple', 'runtime', 'directory', 'route'] as const)(
    'does not lock in A after another window changes %s',
    async field => {
      const input = candidate()
      const state = stateWithAgent()
      if (field === 'directory') {
        Object.assign(state.workspaces[0].nodes[0].agent, { executionDirectory: '/other' })
      }
      if (field === 'route') {
        Object.assign(state.workspaces[0].nodes[0], {
          workerBinding: { endpointId: 'local', mountId: 'changed' },
        })
      }
      if (field === 'tuple') {
        Object.assign(state.workspaces[0].nodes[0].agent, tupleB)
      }
      if (field === 'runtime') {
        state.workspaces[0].nodes[0].sessionId = 'runtime-B'
      }
      await store.writeAppState(state)
      expect(await store.activateManagedClaudeRuntime(input)).toEqual({ status: 'superseded' })
      expect((await reopen()).binding).toBeNull()
      const canonical = await store.readAppState()
      if (field === 'tuple') {
        expect(canonical).toMatchObject({ workspaces: [{ nodes: [{ agent: tupleB }] }] })
        const reread = candidate()
        expect(
          await store.activateManagedClaudeRuntime({
            ...reread,
            tuple: tupleB,
            runtimeSessionId: 'spawned-B',
          }),
        ).toMatchObject({ status: 'committed' })
        expect(store.observeManagedClaudeNode('agent').binding?.tuple).toEqual(tupleB)
      }
      // Re-read the authoritative recovery state before a new attempt; no stale replay.
      expect(store.observeManagedClaudeNode('agent').adoptionSnapshot).not.toBe(
        input.adoptionSnapshot,
      )
    },
  )
  it.each(['standby', 'stopped'])(
    'allows explicit relaunch presentation to move %s to restoring',
    async status => {
      const state = stateWithAgent()
      Object.assign(state.workspaces[0].nodes[0], { status, endedAt: '2026-11-01', exitCode: 1 })
      await store.writeAppState(state)
      const input = candidate()
      Object.assign(state.workspaces[0].nodes[0], {
        status: 'restoring',
        endedAt: null,
        exitCode: null,
      })
      Object.assign(state.workspaces[0].nodes[0].agent, {
        launchMode: 'resume',
        prompt: 'Presentation update',
        expectedDirectory: '/display',
      })
      await store.writeAppState(state)
      expect(await store.activateManagedClaudeRuntime(input)).toMatchObject({ status: 'committed' })
    },
  )
  it('rejects a cold adoption stopped by a competing writer', async () => {
    const input = { ...candidate(), requireRecoverable: true }
    const state = stateWithAgent()
    Object.assign(state.workspaces[0].nodes[0], { status: 'stopped' })
    await store.writeAppState(state)
    expect(await store.activateManagedClaudeRuntime(input)).toEqual({ status: 'superseded' })
    expect(store.observeManagedClaudeNode('agent').binding).toBeNull()
  })
  it('rechecks unverified blank-agent eligibility without fencing verified prompt presentation', async () => {
    const state = stateWithAgent()
    Object.assign(state.workspaces[0].nodes[0].agent, {
      resumeSessionId: null,
      resumeSessionIdVerified: false,
      prompt: '',
    })
    await store.writeAppState(state)
    const input = candidate()
    Object.assign(state.workspaces[0].nodes[0].agent, { prompt: 'A pending task' })
    await store.writeAppState(state)
    expect(await store.activateManagedClaudeRuntime(input)).toEqual({ status: 'superseded' })
  })
  it('allows unrelated layout publication between preparation and activation', async () => {
    const input = candidate(),
      state = stateWithAgent()
    state.workspaces[0].nodes[0].position.x = 99
    await store.writeAppState(state)
    expect(await store.activateManagedClaudeRuntime(input)).toMatchObject({ status: 'committed' })
    expect(await store.readAppState()).toMatchObject({
      workspaces: [{ nodes: [{ position: { x: 99 } }] }],
    })
  })
  it('reopens unowned after spawn without activation or a renderer save', async () => {
    const input = candidate() // process created spawned-A, then died before activation
    expect(input.runtimeSessionId).toBe('spawned-A')
    expect((await reopen()).binding).toBeNull()
    expect(await store.readAppState()).toMatchObject({
      workspaces: [{ nodes: [{ sessionId: 'old', agent: tupleA }] }],
    })
  })
  it('reopens owned after activation before receipt delivery or UI publication', async () => {
    await store.activateManagedClaudeRuntime(candidate()) // deliberately discard receipt
    expect((await reopen()).binding).toMatchObject({
      runtimeSessionId: 'spawned-A',
      tuple: tupleA,
      nodeSeen: true,
    })
    expect(await store.readAppState()).toMatchObject({
      workspaces: [{ nodes: [{ sessionId: 'spawned-A', agent: tupleA }] }],
    })
  })
  it('keeps a new task/CLI activation row-only across reopen', async () => {
    expect(
      await store.activateManagedClaudeRuntime({
        ...candidate(),
        nodeId: 'not-published',
        adoptionSnapshot: undefined,
      }),
    ).toEqual({ status: 'committed' })
    await reopen()
    expect(store.observeManagedClaudeNode('not-published')).toMatchObject({
      context: null,
      binding: { nodeSeen: false },
    })
  })
})
