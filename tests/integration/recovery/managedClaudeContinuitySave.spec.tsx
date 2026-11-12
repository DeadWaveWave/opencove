import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { useHydrateAppState } from '@app/renderer/shell/hooks/useHydrateAppState'
import { usePersistedAppState } from '@app/renderer/shell/hooks/usePersistedAppState'
import { useWorkerSyncStateUpdates } from '@app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { flushScheduledPersistedStateWriteAsync } from '@contexts/workspace/presentation/renderer/utils/persistence/schedule'
import { requestCanonicalRefresh } from '@contexts/workspace/presentation/renderer/utils/persistence/canonicalRefresh'
import { holdPrepare, releasePrepare } from '../../e2e/managedClaudePreparationHold'
import {
  freezeManagedClient,
  waitForManagedCanonicalLayout,
  waitForManagedLayoutWrite,
} from '../../e2e/managedClaudeContinuityDiagnostics'
import { writeRawPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { fixture } from '../../support/convergence/fixture'
import { Server } from '../../support/convergence/server'
import { installMockStorage } from '../../support/persistenceTestStorage'

const original = {
  api: Object.getOwnPropertyDescriptor(window, 'opencoveApi'),
  app: useAppStore.getState(),
  storage: window.localStorage,
}
const page = {
  addInitScript: async (script: (id: string) => void, id: string) => script(id),
  evaluate: async (script: (arg: unknown) => unknown, arg: unknown) =>
    structuredClone(await script(arg)),
} as unknown as Page
const produce = () => {
  const s = useAppStore.getState()
  return toPersistedState(s.workspaces, s.activeWorkspaceId, s.agentSettings)
}
function useClient() {
  const state = useAppStore()
  const hydration = useHydrateAppState(state)
  useWorkerSyncStateUpdates({ enabled: hydration.isPersistReady })
  const persistence = usePersistedAppState({
    ...state,
    ...hydration,
    producePersistedState: produce,
  })
  return { ...hydration, ...persistence }
}
afterEach(async () => {
  cleanup()
  Object.assign(window, { __dropManagedSync: false })
  await flushScheduledPersistedStateWriteAsync()
  if (original.api) {
    Object.defineProperty(window, 'opencoveApi', original.api)
  } else {
    Reflect.deleteProperty(window, 'opencoveApi')
  }
  useAppStore.setState(original.app, true)
  Object.defineProperty(window, 'localStorage', { configurable: true, value: original.storage })
  for (const key of [
    '__heldManagedPrepare',
    '__releaseManagedPrepare',
    '__dropManagedSync',
    '__correctedManagedWrite',
    '__managedContinuity',
  ]) {
    Reflect.deleteProperty(window, key)
  }
  vi.unstubAllGlobals()
})
async function setup(cas = false) {
  installMockStorage()
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
    },
  )
  const server = new Server(fixture(true), 'committed')
  const invoke = server.invoke.bind(server)
  server.invoke = async (id, payload) => {
    if (cas && id === 'sync.writeState' && payload.baseRevision !== server.model.revision) {
      throw { code: 'persistence.invalid_state', debugMessage: 'revision conflict' }
    }
    return await invoke(id, payload)
  }
  const api = server.api('web') // Real Browser adapter; only its HTTP peer is in memory.
  const transport = globalThis.fetch
  vi.stubGlobal('fetch', async (url, init) => {
    const response = await transport(url, init)
    return new Response(await response.text(), { status: response.status })
  })
  await holdPrepare(page, 'agent')
  const submit = vi.spyOn(api, 'writeAppState')
  window.opencoveApi = {
    meta: { runtime: 'browser', isTest: false },
    persistence: api,
    sync: { onStateUpdated: () => () => {} },
    controlSurface: {
      invoke: async (request: { id: string; payload: { nodeIds?: string[] } }) => {
        if (request.id === 'system.capabilities') {
          return { features: { managedClaudeResumeBindingDeliveryV1: true } }
        }
        if (request.id !== 'session.prepareOrRevive') {
          return null
        }
        const snapshot = server.read()
        return {
          nodes: snapshot
            .state!.workspaces[0].nodes.filter(n => request.payload.nodeIds?.includes(n.id))
            .map(n => ({
              ...n,
              nodeId: n.id,
              sessionId: n.sessionId,
              recoveryState: 'live',
              isLiveSessionReattach: true,
              managedClaudeBinding: n.agent
                ? {
                    ...n.managedClaudeResumeBindingOwnership,
                    nodeId: n.id,
                    tuple: {
                      resumeSessionId: n.agent.resumeSessionId,
                      resumeSessionIdVerified: true,
                    },
                    nodeSeen: true,
                    bindingRevision: 1,
                    observedRevision: snapshot.revision,
                  }
                : undefined,
            })),
        }
      },
    },
  } as unknown as typeof window.opencoveApi
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null, persistNotice: null })
  const client = renderHook(useClient)
  await waitFor(() =>
    expect(
      (window as unknown as { __heldManagedPrepare?: unknown }).__heldManagedPrepare,
    ).toBeTruthy(),
  )
  return { server, client, submit }
}
function commitB(server: Server) {
  window.__managedContinuity!.b = 'B'
  server.model.value.tuple = 'B'
  server.model.history.set(++server.model.revision, { ...server.model.value })
}
function move(x = 120, y = 80) {
  useAppStore.getState().setWorkspaces(ws =>
    ws.map(w => ({
      ...w,
      nodes: w.nodes.map(n => (n.id === 'agent' ? { ...n, position: { x, y } } : n)),
    })),
  )
}
it.each([false, true])(
  'publishes stale A layout through real hydration/autosave and the Browser adapter with cas=%s',
  async cas => {
    const t = await setup(cas)
    Object.assign(window, { __dropManagedSync: true })
    commitB(t.server)
    await act(async () => {
      await releasePrepare(page)
    })
    await waitFor(() => expect(t.client.result.current.isHydrated).toBe(true))
    expect(produce().workspaces[0].nodes[0].agent?.resumeSessionId).toBe('A')
    await act(async () => {
      move()
    })
    await waitFor(() => expect(t.submit).toHaveBeenCalled())
    const result = await t.submit.mock.results[0].value
    expect(result).toMatchObject({ ok: true, corrected: !cas, merged: true })
    expect(
      (t.submit.mock.calls[0][0].state as ReturnType<typeof produce>).workspaces[0].nodes[0],
    ).toMatchObject({ agent: { resumeSessionId: 'A' }, position: { x: 120, y: 80 } })
    await waitFor(() => expect(produce().workspaces[0].nodes[0].agent?.resumeSessionId).toBe('B'))
    expect(t.server.model.value.position).toBe('120,80')
    const write = await waitForManagedLayoutWrite(page, {
      afterSeq: 0,
      before: { x: 0, y: 0 },
      stale: true,
      timeout: 500,
    })
    await waitForManagedCanonicalLayout(
      page,
      'agent',
      write,
      { resumeSessionId: 'B', resumeSessionIdVerified: true },
      500,
    )
    expect(window.__managedContinuity!.reads.some(r => r.route === 'wire:sync.state')).toBe(true)
  },
)
it('does not mistake a metadata-only flush for a committed layout change', async () => {
  const t = await setup()
  await act(async () => {
    await releasePrepare(page)
  })
  await waitFor(() => expect(t.client.result.current.isHydrated).toBe(true))
  await act(async () => {
    await flushScheduledPersistedStateWriteAsync()
  })
  t.submit.mockClear()
  const afterSeq = window.__managedContinuity!.seq
  Object.assign(window, { __dropManagedSync: true })
  commitB(t.server)
  await act(async () => {
    t.client.result.current.requestPersistFlush()
    await flushScheduledPersistedStateWriteAsync()
  })
  expect(
    t.submit.mock.calls.every(
      ([input]) =>
        (input.state as ReturnType<typeof produce>).workspaces[0].nodes[0].position.x === 0,
    ),
  ).toBe(true)
  await expect(
    waitForManagedLayoutWrite(page, { afterSeq, before: { x: 0, y: 0 }, stale: true, timeout: 5 }),
  ).rejects.toThrow(/Read\/write evidence[\s\S]*"reads"[\s\S]*"writes"/)
  expect(
    window
      .__managedContinuity!.writes.filter(w => w.seq > afterSeq)
      .every(w => w.candidate?.position?.x === 0),
  ).toBe(true)
})
it('reports a normal receipt when the client already applied B before moving', async () => {
  const t = await setup()
  await act(async () => {
    await releasePrepare(page)
  })
  await waitFor(() => expect(t.client.result.current.isHydrated).toBe(true))
  commitB(t.server)
  act(() => requestCanonicalRefresh({ reason: 'connect' }))
  await waitFor(() => expect(produce().workspaces[0].nodes[0].agent?.resumeSessionId).toBe('B'))
  await act(async () => {
    move()
    await flushScheduledPersistedStateWriteAsync()
  })
  await waitFor(() => expect(t.submit).toHaveBeenCalled())
  expect(await t.submit.mock.results[0].value).toMatchObject({ ok: true, corrected: false })
  await expect(
    waitForManagedLayoutWrite(page, {
      afterSeq: 0,
      before: { x: 0, y: 0 },
      stale: true,
      timeout: 5,
    }),
  ).rejects.toThrow(/"carried":"B"/)
})

it('bounds the no-publication case with read revisions and an empty write log', async () => {
  await setup()
  try {
    await expect(
      waitForManagedLayoutWrite(page, {
        afterSeq: window.__managedContinuity!.seq,
        before: { x: 0, y: 0 },
        stale: true,
        timeout: 5,
      }),
    ).rejects.toThrow(/"writes":\[\]/)
  } finally {
    await act(async () => {
      await releasePrepare(page)
    })
  }
})

it('logs raw correction and rejection without freezing the required canonical B read', async () => {
  const t = await setup()
  Object.assign(window, { __dropManagedSync: true })
  commitB(t.server)
  await act(async () => {
    await releasePrepare(page)
  })
  await waitFor(() => expect(t.client.result.current.isHydrated).toBe(true))
  const stale = produce()
  stale.workspaces[0].nodes[0].position = { x: 190, y: 80 }
  await act(async () => {
    expect(await writeRawPersistedState(JSON.stringify(stale))).toMatchObject({
      ok: true,
      corrected: true,
    })
  })
  await waitFor(() => expect(produce().workspaces[0].nodes[0].agent?.resumeSessionId).toBe('B'))
  expect(window.__managedContinuity!.writes).toContainEqual(
    expect.objectContaining({
      route: 'raw',
      carried: 'A',
      ok: true,
      corrected: true,
      merged: null,
      revision: expect.any(Number),
    }),
  )
  expect(
    await window.opencoveApi.persistence.writeWorkspaceStateRaw({ raw: 'invalid JSON' }),
  ).toMatchObject({ ok: false })
  expect(window.__managedContinuity!.writes).toContainEqual(
    expect.objectContaining({
      route: 'raw',
      candidate: null,
      ok: false,
      error: 'persistence.invalid_state',
    }),
  )
})
it('starts the stale phase with a fresh A read and clears any bootstrap receipt marker', async () => {
  const t = await setup()
  await act(async () => {
    await releasePrepare(page)
  })
  await waitFor(() => expect(t.client.result.current.isHydrated).toBe(true))
  await act(async () => {
    move()
    await flushScheduledPersistedStateWriteAsync()
  })
  await waitFor(() => expect(t.submit).toHaveBeenCalled())
  await window.opencoveApi.persistence.readAppState()
  Object.assign(window, { __correctedManagedWrite: true })
  await freezeManagedClient(page)
  const afterSeq = window.__managedContinuity!.seq
  commitB(t.server)
  const frozen = await window.opencoveApi.persistence.readAppState()
  expect((frozen.state as ReturnType<typeof produce>).workspaces[0].nodes[0]).toMatchObject({
    agent: { resumeSessionId: 'A' },
    position: { x: 120, y: 80 },
  })
  expect((window as unknown as { __correctedManagedWrite: boolean }).__correctedManagedWrite).toBe(
    false,
  )
  await act(async () => {
    move(240, 160)
    await flushScheduledPersistedStateWriteAsync()
  })
  const write = await waitForManagedLayoutWrite(page, {
    afterSeq,
    before: { x: 120, y: 80 },
    stale: true,
    timeout: 500,
  })
  await waitForManagedCanonicalLayout(
    page,
    'agent',
    write,
    { resumeSessionId: 'B', resumeSessionIdVerified: true },
    500,
  )
  await waitFor(() => expect(produce().workspaces[0].nodes[0].agent?.resumeSessionId).toBe('B'))
  expect(t.server.model.value.position).toBe('240,160')
})

it('rejects the real Browser adapter uncertain merged result when the peer omits its commit revision', async () => {
  const t = await setup()
  Object.assign(window, { __dropManagedSync: true })
  commitB(t.server)
  await act(async () => {
    await releasePrepare(page)
  })
  await waitFor(() => expect(t.client.result.current.isHydrated).toBe(true))
  const invoke = t.server.invoke.bind(t.server)
  t.server.invoke = async (id, payload) => {
    const receipt = await invoke(id, payload)
    return id === 'sync.writeState' ? {} : receipt
  }
  await act(async () => {
    move()
  })
  await waitFor(() => expect(t.submit).toHaveBeenCalled())
  await act(async () => {
    await flushScheduledPersistedStateWriteAsync()
  })
  expect(await t.submit.mock.results[0].value).toMatchObject({
    ok: true,
    uncertain: true,
    merged: true,
  })
  await expect(
    waitForManagedLayoutWrite(page, {
      afterSeq: 0,
      before: { x: 0, y: 0 },
      stale: true,
      timeout: 20,
    }),
  ).rejects.toThrow(/confirmed commit revision[\s\S]*"uncertain":true,"revision":null/)
})

it('times out with the submitted A and pending receipt when the HTTP peer delays its response', async () => {
  const t = await setup()
  Object.assign(window, { __dropManagedSync: true })
  commitB(t.server)
  await act(async () => {
    await releasePrepare(page)
  })
  await waitFor(() => expect(t.client.result.current.isHydrated).toBe(true))
  t.server.delayResponse = true
  await act(async () => {
    move()
  })
  try {
    await waitFor(() =>
      expect(window.__managedContinuity!.writes.some(w => w.route === 'structured')).toBe(true),
    )
    await expect(
      waitForManagedLayoutWrite(page, {
        afterSeq: 0,
        before: { x: 0, y: 0 },
        stale: true,
        timeout: 5,
      }),
    ).rejects.toThrow(/"carried":"A"[\s\S]*"ok":null/)
  } finally {
    t.server.reply()
    await act(async () => {
      await flushScheduledPersistedStateWriteAsync()
    })
  }
})
