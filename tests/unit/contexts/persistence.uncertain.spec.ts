import { createDesktopOpenCoveApi } from '@app/renderer/bootstrap/installDesktopOpenCoveApi'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import {
  writePersistedState,
  markPersistedStateAsSynced,
  getPendingPublication,
  reconcileCanonicalPublication,
} from '@contexts/workspace/presentation/renderer/utils/persistence/write'
const original = window.opencoveApi
const base = {
  formatVersion: 1,
  activeWorkspaceId: null,
  workspaces: [],
  settings: DEFAULT_AGENT_SETTINGS,
}
const candidate = { ...base, settings: { ...base.settings, releaseNotesSeenVersion: 'draft' } }
afterEach(() =>
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: original }),
)
it.each(['committed', 'not committed', 'third-party write'] as const)(
  'retains an unconfirmed draft and never auto-replays when response is lost: %s',
  async outcome => {
    const executed = vi.fn(async () => ({ corrupted: true }))
    const write = createDesktopOpenCoveApi({ persistence: { writeAppState: executed } } as never)
      .persistence.writeAppState
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { persistence: { writeAppState: write } },
    })
    markPersistedStateAsSynced(base, 1)
    expect(await writePersistedState(candidate)).toMatchObject({ ok: false })
    const pending = getPendingPublication()!
    expect(pending).toMatchObject({ kind: 'uncertain-refresh', unknownOutcome: true })
    expect(pending.ancestorRaw).not.toBe(pending.candidateRaw)
    const canonical =
      outcome === 'committed'
        ? candidate
        : outcome === 'not committed'
          ? base
          : { ...base, settings: { ...base.settings, releaseNotesSeenVersion: 'external' } }
    expect(
      reconcileCanonicalPublication(canonical, candidate).settings.releaseNotesSeenVersion,
    ).toBe(canonical.settings.releaseNotesSeenVersion)
    expect(JSON.parse(getPendingPublication()!.draftRaw!).settings.releaseNotesSeenVersion).toBe(
      'draft',
    )
    markPersistedStateAsSynced(canonical, 3)
    expect(getPendingPublication()?.unknownOutcome).toBe(true)
    await writePersistedState(candidate)
    expect(executed).toHaveBeenCalledOnce()
  },
)
it('keeps a known committed correction pending when a reconciliation read fails', async () => {
  const write = vi.fn(async () => ({
    ok: true,
    level: 'full',
    bytes: 1,
    revision: 3,
    corrected: true,
  }))
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      persistence: {
        writeAppState: write,
        readAppState: vi.fn().mockRejectedValue(new Error('unavailable')),
      },
    },
  })
  markPersistedStateAsSynced(base, 1)
  await writePersistedState(candidate)
  expect(await writePersistedState(base)).toMatchObject({ ok: false })
  expect(getPendingPublication()).toMatchObject({ kind: 'committed-refresh', minimumRevision: 3 })
  expect(write).toHaveBeenCalledOnce()
})
