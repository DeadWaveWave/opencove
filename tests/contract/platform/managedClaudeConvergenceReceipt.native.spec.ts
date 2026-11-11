// @vitest-environment node
import { createControlSurfaceHttpServerContext } from '@app/main/controlSurface/controlSurfaceHttpServerContext'
import { afterEach, expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '@platform/persistence/sqlite/PersistenceStore'
import { createControlSurface } from '@app/main/controlSurface/controlSurface'
import { registerSyncHandlers } from '@app/main/controlSurface/handlers/syncHandlers'
import { stateWithAgent, tupleA, tupleB } from './managedClaudeResumeBindingFixtures'
import { staleManagedPublication } from '../../support/convergence/staleManagedPublication'

let store: Awaited<ReturnType<typeof createPersistenceStore>> | undefined
afterEach(() => {
  store?.dispose()
  store = undefined
})
describeWithElectronNativeModules('managed Claude convergence correction preconditions', () => {
  for (const raw of [false, true]) {
    it.each([false, true])(
      `reports a deliberately stale ${raw ? 'raw' : 'structured'} tuple after late attestation=%s`,
      async late => {
        const s = (store = await createPersistenceStore({
          dbPath: ':memory:',
          strictRecovery: true,
        }))
        await s.writeAppState(stateWithAgent())
        await s.activateManagedClaudeRuntime({
          nodeId: 'agent',
          activationId: 'activation',
          runtimeSessionId: 'runtime',
          tuple: tupleA,
        })
        const beforeAttestation = { ...tupleB, resumeSessionIdVerified: false }
        await s.commitManagedClaudeRebind({
          nodeId: 'agent',
          activationId: 'rebind',
          runtimeSessionId: 'runtime',
          expected: tupleA,
          next: beforeAttestation,
        })
        const captured = (await s.readAppStateSnapshot!())!.state
        const saved = structuredClone(captured)
        const proposed = staleManagedPublication(captured, 'agent', 1300)
        expect(captured).toEqual(saved)
        expect(proposed.submittedTuple.resumeSessionId).not.toBe(
          proposed.canonicalTuple.resumeSessionId,
        )
        if (late) {
          await s.commitManagedClaudeRebind({
            nodeId: 'agent',
            activationId: 'attested',
            runtimeSessionId: 'runtime',
            expected: beforeAttestation,
            next: { ...tupleB, resumeSessionIdVerified: true },
          })
        }
        const control = createControlSurface()
        registerSyncHandlers(control, async () => s)
        const result = await control.invoke(
          createControlSurfaceHttpServerContext({
            enableWebShell: false,
            ptyProtocolVersion: 1,
            replayWindowMaxBytes: 1024,
          }),
          raw
            ? {
                kind: 'command',
                id: 'sync.writeWorkspaceStateRaw',
                payload: { raw: JSON.stringify(proposed.candidate) },
              }
            : {
                kind: 'command',
                id: 'sync.writeState',
                payload: {
                  state: proposed.candidate,
                  baseRevision: await s.readAppStateRevision(),
                },
              },
        )
        expect(result).toMatchObject({ ok: true, value: { corrected: true } })
        expect(await s.readAppState()).toMatchObject({
          workspaces: [
            {
              nodes: [
                { position: { x: 1300 }, agent: { ...tupleB, resumeSessionIdVerified: late } },
              ],
            },
          ],
        })
      },
    )
    it(`correctly reports an already-current ${raw ? 'raw' : 'structured'} publication as uncorrected`, async () => {
      const s = (store = await createPersistenceStore({ dbPath: ':memory:', strictRecovery: true }))
      await s.writeAppState(stateWithAgent())
      await s.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'activation',
        runtimeSessionId: 'runtime',
        tuple: tupleA,
      })
      const snapshot = (await s.readAppStateSnapshot!())!
      const result = raw
        ? await s.writeWorkspaceStateRaw(JSON.stringify(snapshot.state))
        : await s.writeAppState(snapshot.state)
      expect(result).toMatchObject({ ok: true, corrected: false })
    })
  }
})

describeWithElectronNativeModules('managed Claude adapter correction provenance', () => {
  it.each(['web', 'remote'] as const)(
    'projects the tuple before the SQLite gate when %s retries a revision conflict',
    async adapter => {
      const { vi } = await import('vitest')
      const { createBrowserPersistenceApi } =
        await import('@app/renderer/browser/browserOpenCoveApi.persistence')
      const { createRemotePersistenceStore } =
        await import('@app/main/controlSurface/remote/remotePersistenceStore')
      const { normalizeAgentSettings } = await import('@contexts/settings/domain/agentSettings')
      const s = (store = await createPersistenceStore({ dbPath: ':memory:', strictRecovery: true }))
      const initial = { ...stateWithAgent(), settings: normalizeAgentSettings({}) }
      Object.assign(initial.workspaces[0].nodes[0].agent, { executionDirectory: '/repo' })
      await s.writeAppState(initial)
      await s.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'current',
        runtimeSessionId: 'runtime',
        tuple: tupleB,
      })
      const canonical = (await s.readAppStateSnapshot!())!
      const proposed = staleManagedPublication(canonical.state, 'agent', 1300)
      const control = createControlSurface()
      registerSyncHandlers(control, async () => s)
      const ctx = createControlSurfaceHttpServerContext({
        enableWebShell: false,
        ptyProtocolVersion: 1,
        replayWindowMaxBytes: 1024,
      })
      let conflicted = false
      vi.stubGlobal('window', { location: { search: '' } })
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, options) => {
          const request = JSON.parse(options!.body as string)
          if (request.id === 'sync.writeState' && !conflicted) {
            conflicted = true
            await s.writeAppState((await s.readAppStateSnapshot!())!.state)
          }
          const result = await control.invoke(ctx, request)
          return {
            status: 200,
            text: async () => JSON.stringify(result),
          }
        }),
      )
      try {
        const api =
          adapter === 'web'
            ? (() => {
                const web = createBrowserPersistenceApi()
                return {
                  read: web.readAppState,
                  write: (state: unknown) => web.writeAppState({ state }),
                  raw: (raw: string) => web.writeWorkspaceStateRaw({ raw }),
                }
              })()
            : (() => {
                const remote = createRemotePersistenceStore(async () => ({
                  hostname: '127.0.0.1',
                  port: 1234,
                  token: 'test',
                }))
                return {
                  read: remote.readAppStateSnapshot!,
                  write: remote.writeAppState,
                  raw: remote.writeWorkspaceStateRaw,
                }
              })()
        await api.read()
        const written = await api.write(proposed.candidate)
        expect(conflicted).toBe(true)
        expect(written).toMatchObject({ ok: true, merged: true, corrected: false })
        expect(await s.readAppState()).toMatchObject({
          workspaces: [{ nodes: [{ position: { x: 1300 }, agent: tupleB }] }],
        })
        const raw = JSON.stringify(proposed.candidate)
        const rawResult = await api.raw(raw)
        expect(rawResult).toMatchObject({ ok: true, corrected: true })
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )
})
