import { act } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Client } from '../../support/convergence/client'
import { writeRawPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import {
  schedulePersistedStateWrite,
  flushScheduledPersistedStateWriteAsync,
} from '@contexts/workspace/presentation/renderer/utils/persistence/schedule'
let client: Client | undefined
afterEach(async () => {
  await client?.close()
  client = undefined
})
it.each(
  [false, true].flatMap(owned =>
    ['raw', 'raw-web', 'raw-remote'].map(adapter => ({
      owned,
      adapter: adapter as 'raw' | 'raw-web' | 'raw-remote',
    })),
  ),
)('serializes queued autosave during $adapter import owned=$owned', async ({ owned, adapter }) => {
  const c = (client = new Client(owned, adapter, 'committed'))
  await c.step('rename')
  schedulePersistedStateWrite(c.state, { delayMs: 10000 })
  const imported = c.state()
  imported.workspaces[0].name = 'Imported project'
  c.server.model.edit('name', 'Imported project')
  c.server.delayResponse = true
  const replacement = writeRawPersistedState(JSON.stringify(imported))
  let queued: Promise<boolean> | undefined
  try {
    await act(async () => {
      await Promise.resolve()
    })
    await c.step('title')
    queued = flushScheduledPersistedStateWriteAsync()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // Flush is genuinely in progress while the raw receipt is held. It must not submit old UI.
    expect(c.server.writes).toBe(1)
    expect(c.server.model.value.name).toBe('Imported project')
  } finally {
    c.server.reply()
    await Promise.all([replacement, queued])
  }
  await c.quiet()
  expect(c.server.model.value).toMatchObject({ name: 'Imported project', title: 'user-2' })
  expect(c.state().workspaces[0].name).toBe('Imported project')
})
it.each(
  ['raw', 'raw-web', 'raw-remote'].flatMap(adapter =>
    ['lost-committed', 'lost-uncommitted'].map(response => ({
      adapter: adapter as 'raw' | 'raw-web' | 'raw-remote',
      response: response as 'lost-committed' | 'lost-uncommitted',
    })),
  ),
)('blocks queued autosave after $adapter $response', async ({ adapter, response }) => {
  const c = (client = new Client(false, adapter, response))
  await c.step('rename')
  schedulePersistedStateWrite(c.state, { delayMs: 10000 })
  c.server.model.edit('name', 'Imported project')
  const imported = c.state()
  imported.workspaces[0].name = 'Imported project'
  c.server.delayResponse = true
  const replacement = writeRawPersistedState(JSON.stringify(imported))
  const queued = flushScheduledPersistedStateWriteAsync()
  try {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(c.server.writes).toBe(1)
  } finally {
    c.server.reply()
    await Promise.all([replacement, queued])
  }
  await c.step('refresh')
  await c.quiet()
  expect(c.server.writes).toBe(1)
  const { getPendingPublication } =
    await import('@contexts/workspace/presentation/renderer/utils/persistence/publicationState')
  expect(getPendingPublication()).toMatchObject({ unknownOutcome: true })
  expect(JSON.parse(getPendingPublication()!.draftRaw!).workspaces[0].name).toBe('Imported project')
})
it.each(['raw', 'raw-web', 'raw-remote'] as const)(
  'orders a replacement after the earlier %s publication',
  async adapter => {
    const c = (client = new Client(false, adapter, 'committed'))
    await c.step('rename')
    c.server.delayResponse = true
    const { writePersistedState } =
      await import('@contexts/workspace/presentation/renderer/utils/persistence/write')
    const earlier = writePersistedState(c.state())
    const imported = c.state()
    imported.workspaces[0].name = 'Imported project'
    c.server.model.edit('name', 'Imported project')
    const replacement = writeRawPersistedState(JSON.stringify(imported))
    try {
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(c.server.writes).toBe(1)
    } finally {
      c.server.reply()
      await Promise.all([earlier, replacement])
    }
    await c.quiet()
    expect(c.server.model.value.name).toBe('Imported project')
  },
)
