import { afterEach, expect, it, vi } from 'vitest'
import { createRemotePersistenceStore } from '@app/main/controlSurface/remote/remotePersistenceStore'
import { createBrowserPersistenceApi } from '@app/renderer/browser/browserOpenCoveApi.persistence'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import { withWorkerCompatibility } from '../../support/workerCompatibilityFetch'

afterEach(() => vi.unstubAllGlobals())

it.each(['desktop', 'web'] as const)(
  '%s preserves a raw replacement theme when the previous renderer saves another edit',
  async adapter => {
    let state = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: { ...DEFAULT_AGENT_SETTINGS, uiTheme: 'dark' },
    }
    let revision = 1
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const { id, payload } = JSON.parse(String(init?.body)) as {
        id: string
        payload: { raw: string; state: typeof state; baseRevision?: number }
      }
      let result: Record<string, unknown>
      if (id === 'sync.state') {
        result = { ok: true, value: { state, revision } }
      } else if (id === 'sync.writeWorkspaceStateRaw') {
        state = JSON.parse(payload.raw)
        result = { ok: true, value: { ok: true, revision: ++revision, level: 'full', bytes: 1 } }
      } else if (id === 'sync.writeState') {
        if (payload.baseRevision !== undefined && payload.baseRevision !== revision) {
          result = {
            ok: false,
            error: {
              code: 'persistence.invalid_state',
              debugMessage: 'revision conflict',
              details: { reason: 'revisionConflict' },
            },
          }
        } else {
          state = payload.state
          result = { ok: true, value: { revision: ++revision, corrected: false } }
        }
      } else {
        throw new Error(`Unexpected operation: ${id}`)
      }
      return new Response(JSON.stringify({ __opencoveControlEnvelope: true, ...result }))
    })
    vi.stubGlobal('fetch', withWorkerCompatibility(fetchMock))
    const remote = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'test',
    }))
    const browser = createBrowserPersistenceApi()
    const api =
      adapter === 'web'
        ? browser
        : {
            readAppState: () => remote.readAppStateSnapshot!(),
            writeWorkspaceStateRaw: ({ raw }: { raw: string }) =>
              remote.writeWorkspaceStateRaw(raw),
            writeAppState: ({
              state: next,
              baseRevision,
            }: {
              state: unknown
              baseRevision: number
            }) => remote.writeAppState(next, { baseRevision }),
          }

    const accepted = await api.readAppState()
    const outgoing = structuredClone(state)
    outgoing.settings.releaseNotesSeenVersion = 'local-edit'
    const replacement = structuredClone(state)
    replacement.settings.uiTheme = 'light'
    expect(await api.writeWorkspaceStateRaw({ raw: JSON.stringify(replacement) })).toMatchObject({
      ok: true,
    })
    expect(state.settings.uiTheme).toBe('light')

    // The outgoing renderer still owns its accepted revision. Its unchanged dark theme
    // is not a user edit, even though a raw replacement has committed in the meantime.
    expect(
      await api.writeAppState({ state: outgoing, baseRevision: accepted.revision! }),
    ).toMatchObject({ ok: true })
    expect(state.settings).toMatchObject({
      uiTheme: 'light',
      releaseNotesSeenVersion: 'local-edit',
    })
    expect((await api.readAppState()).state).toMatchObject({ settings: { uiTheme: 'light' } })
  },
)
