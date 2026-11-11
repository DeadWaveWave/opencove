import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '../../support/convergence/client'
import { snapshot } from '../../support/convergence/fixture'
import {
  capturePublication,
  drainPersistedStateAtQuit,
} from '@contexts/workspace/presentation/renderer/utils/persistence/drain'
import { markPersistedStateAsSynced } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { getPendingPublication } from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import { readPersistedStateWithMeta } from '@contexts/workspace/presentation/renderer/utils/persistence/read'
import { STORAGE_KEY } from '@contexts/workspace/presentation/renderer/utils/persistence/constants'
let c: Client | undefined
afterEach(async () => {
  await c?.close()
  c = undefined
})
it('drains only the captured edit delta across a newer acceptance', async () => {
  c = new Client(false, 'local', 'committed')
  await c.step('title')
  const captured = capturePublication(c.state())
  c.server.model.thirdParty()
  markPersistedStateAsSynced(
    snapshot(c.server.template, c.server.model.value),
    c.server.model.revision,
  )
  expect(await drainPersistedStateAtQuit(captured)).toBe(true)
  expect(c.server.model.value).toMatchObject({ name: 'external-1', title: 'user-0' })
})
it('retains a same-field capture conflict rather than overwriting a newer acceptance', async () => {
  c = new Client(false, 'local', 'committed')
  await c.step('rename')
  const captured = capturePublication(c.state())
  c.server.model.thirdParty()
  markPersistedStateAsSynced(
    snapshot(c.server.template, c.server.model.value),
    c.server.model.revision,
  )
  expect(await drainPersistedStateAtQuit(captured)).toBe(false)
  expect(c.server.writes).toBe(0)
  expect(getPendingPublication()).toMatchObject({
    blockedReason: 'conflict',
    draftRaw: expect.stringContaining('user-0'),
  })
  await c.step('observe')
  await c.step('refresh')
  c.check(true)
})
it('does not publish after a quit deadline when its captured read completes late', async () => {
  c = new Client(false, 'local', 'committed')
  await c.step('rename')
  let finish!: (snapshot: unknown) => void
  window.opencoveApi.persistence.readAppState = vi.fn(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  ) as never
  const drained = drainPersistedStateAtQuit(capturePublication(c.state()), 25)
  await vi.advanceTimersByTimeAsync(30)
  expect(await drained).toBe(false)
  finish(c.server.read())
  await Promise.resolve()
  expect(c.server.writes).toBe(0)
})
it('recovers terminal history after the migration commit response was lost', async () => {
  c = new Client(false, 'local', 'committed')
  const legacy = c.state()
  legacy.workspaces[0].nodes.find(n => n.id === 'terminal')!.scrollback = 'retained history'
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy))
  c.server.nextReadNull = true
  c.server.response = 'lost-committed'
  expect(await readPersistedStateWithMeta()).toMatchObject({ isPersisted: false })
  expect(await readPersistedStateWithMeta()).toMatchObject({ isPersisted: true })
  expect(c.server.scrollbacks.get('terminal')).toBe('retained history')
})
