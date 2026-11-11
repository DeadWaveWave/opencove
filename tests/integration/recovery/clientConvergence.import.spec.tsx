/* eslint-disable no-await-in-loop -- Exercise both ambiguous outcomes through each actual adapter. */
import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '../../support/convergence/client'
import {
  writeRawPersistedState,
  writePersistedState,
} from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { getPendingPublication } from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import { invalidStateResult } from '@platform/persistence/sqlite/appStateWriteResult'
let c: Client | undefined
afterEach(async () => {
  await c?.close()
  c = undefined
})
it.each(['raw', 'raw-remote', 'raw-web'] as const)(
  'applies a different %s import without replaying the pre-import UI',
  async adapter => {
    c = new Client(false, adapter, 'committed')
    const imported = c.state()
    imported.workspaces[0].name = 'Imported project'
    expect(await writeRawPersistedState(JSON.stringify(imported))).toMatchObject({ ok: true })
    await c.step('observe')
    await c.step('refresh')
    await c.quiet()
    expect(c.server.model.value.name).toBe('Imported project')
    expect(c.state().workspaces[0].name).toBe('Imported project')
  },
)
it.each(['raw', 'raw-remote', 'raw-web'] as const)(
  'preserves only edits made after %s submission',
  async adapter => {
    c = new Client(false, adapter, 'committed')
    await c.step('rename')
    c.server.model.edit('name', 'Imported project')
    const imported = c.state()
    imported.workspaces[0].name = 'Imported project'
    c.server.delayResponse = true
    const written = writeRawPersistedState(JSON.stringify(imported))
    await Promise.resolve()
    await c.step('title')
    c.server.reply()
    await written
    await c.step('observe')
    await c.step('refresh')
    await c.quiet()
    expect(c.server.model.value).toMatchObject({ name: 'Imported project', title: 'user-2' })
  },
)
it('allows a valid save after SQLite rejects a malformed raw submission', async () => {
  c = new Client(false, 'local', 'committed')
  const invalid = invalidStateResult('Workspace state payload must be a JSON object.')
  const raw = vi
    .spyOn(window.opencoveApi.persistence, 'writeWorkspaceStateRaw')
    .mockResolvedValueOnce(invalid)
  expect(await writeRawPersistedState('{')).toMatchObject({
    ok: false,
    outcome: 'rejected',
    reason: 'unknown',
  })
  expect(getPendingPublication()).toBeNull()
  await c.step('rename')
  expect(await writePersistedState(c.state())).toMatchObject({ ok: true })
  expect(c.server.writes).toBe(1)
  raw.mockRestore()
})

it.each(['raw', 'raw-remote', 'raw-web'] as const)(
  'retains a different %s import after either lost outcome',
  async adapter => {
    for (const response of ['lost-committed', 'lost-uncommitted'] as const) {
      c = new Client(false, adapter, response)
      const imported = c.state()
      imported.workspaces[0].name = 'Imported project'
      expect(await writeRawPersistedState(JSON.stringify(imported))).toMatchObject({
        ok: false,
        outcome: 'unknown',
      })
      await c.step('title')
      await c.step('observe')
      await c.step('refresh')
      await c.quiet()
      const pending = getPendingPublication()!
      expect(pending.unknownOutcome).toBe(true)
      expect(JSON.parse(pending.draftRaw!).workspaces[0]).toMatchObject({
        name: 'Imported project',
        nodes: expect.arrayContaining([expect.objectContaining({ id: 'agent', title: 'user-0' })]),
      })
      expect(c.server.model.value.name).toBe(
        response === 'lost-committed' ? 'Imported project' : 'Project',
      )
      expect(c.server.writes).toBe(1)
      await c.close()
      c = undefined
    }
  },
)
