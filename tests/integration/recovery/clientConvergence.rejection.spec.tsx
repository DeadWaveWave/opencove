import { afterEach, expect, it } from 'vitest'
import { Client } from '../../support/convergence/client'
import type { Adapter } from '../../support/convergence/server'
import { writeRawPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { getPendingPublication } from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import { getPersistencePort } from '@contexts/workspace/presentation/renderer/utils/persistence/port'

let client: Client | undefined
afterEach(async () => {
  await client?.close()
  client = undefined
})
it.each(['local', 'remote', 'web', 'raw', 'raw-remote', 'raw-web'] as Adapter[])(
  'continues saving after actual %s validation envelopes',
  async adapter => {
    const c = (client = new Client(false, adapter, 'committed'))
    // Local/raw uses SQLite's legacy reason unknown; Web/remote structured writes use an error envelope.
    const raw = await writeRawPersistedState('{')
    expect(raw).toMatchObject({
      ok: false,
      reason: 'unknown',
      outcome: 'rejected',
      error: { code: 'persistence.invalid_state' },
    })
    expect(getPendingPublication()).toBeNull()
    expect(await getPersistencePort()!.writeAppState(null)).toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'persistence.invalid_state' },
    })
    await c.step('rename')
    expect(await c.write()).toMatchObject({ ok: true })
    await c.quiet()
    expect(c.server.model.value.name).toBe('user-0')
  },
)
