import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import {
  markPersistedStateAsSynced,
  writePersistedState,
  writeRawPersistedState,
  getPendingPublication,
  reconcileCanonicalPublication,
  canAcceptCanonicalRevision,
} from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { subscribeCanonicalRefresh } from '@contexts/workspace/presentation/renderer/utils/persistence/canonicalRefresh'
import { isRetiredManagedNode } from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
const original = window.opencoveApi
const base = {
  formatVersion: 1,
  activeWorkspaceId: null,
  workspaces: [],
  settings: DEFAULT_AGENT_SETTINGS,
}
const local = { ...base, settings: { ...base.settings, releaseNotesSeenVersion: 'local' } }
afterEach(() =>
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: original }),
)
function api(
  write = vi.fn(async () => ({ ok: true, level: 'full', bytes: 1, revision: 3, corrected: true })),
) {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: { persistence: { writeAppState: write } },
  })
  markPersistedStateAsSynced(base, 1)
  return write
}
it('retains correction demand for late subscribers and keeps a revision floor', async () => {
  api()
  await writePersistedState(local)
  const listener = vi.fn()
  const off = subscribeCanonicalRefresh(listener)
  expect(listener).toHaveBeenCalled()
  off()
  expect(getPendingPublication()).toMatchObject({ kind: 'committed-refresh', minimumRevision: 3 })
  expect(canAcceptCanonicalRevision(2)).toBe(false)
  const canonical = { ...local, settings: { ...local.settings, language: 'zh-CN' as const } }
  expect(reconcileCanonicalPublication(canonical, base)).toMatchObject({
    settings: { language: 'zh-CN', releaseNotesSeenVersion: base.settings.releaseNotesSeenVersion },
  })
})
it('a response after a newer applied snapshot cannot recreate pending state', async () => {
  let finish!: (value: unknown) => void
  api(
    vi.fn(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    ) as never,
  )
  const pending = writePersistedState(local)
  markPersistedStateAsSynced(local, 4)
  finish({ ok: true, level: 'full', bytes: 1, revision: 3, corrected: true })
  await pending
  expect(getPendingPublication()).toBeNull()
})
it('identity rejection retains the accepted ancestor and permitted edits', async () => {
  api(
    vi.fn(async () => ({
      ok: false,
      reason: 'io',
      error: {
        code: 'persistence.owned_node_identity_conflict',
        details: { nodeId: 'retired', field: 'id', reason: 'retired' },
      },
    })) as never,
  )
  expect(await writePersistedState(local)).toMatchObject({ ok: false })
  expect(getPendingPublication()).toMatchObject({ kind: 'rejected-rebase' })
  const canonical = { ...base, settings: { ...base.settings, language: 'zh-CN' as const } }
  expect(reconcileCanonicalPublication(canonical, local)).toMatchObject({
    settings: { language: 'zh-CN', releaseNotesSeenVersion: 'local' },
  })
})

it('keeps a raw replacement failure typed and retires its rejected node immediately', async () => {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      persistence: {
        writeWorkspaceStateRaw: vi.fn(async () => ({
          ok: false,
          reason: 'io',
          error: {
            code: 'persistence.owned_node_identity_conflict',
            details: { nodeId: 'raw-retired', field: 'id', reason: 'retired' },
          },
        })),
      },
    },
  })
  markPersistedStateAsSynced(base, 1)
  expect(await writeRawPersistedState(JSON.stringify(local))).toMatchObject({
    ok: false,
    error: { code: 'persistence.owned_node_identity_conflict' },
  })
  expect(isRetiredManagedNode('raw-retired')).toBe(true)
  expect(getPendingPublication()).toBeNull()
})
