import { expect, it } from 'vitest'
import { Client } from '../../support/convergence/client'

it('persists view intent while a previous shared submission is unconfirmed', async () => {
  const c = new Client(false, 'local', 'lost-uncommitted')
  try {
    await c.step('rename')
    await c.step('schedule')
    await c.step('flush')
    await c.step('view')
    await c.step('observe')
    await c.step('refresh')
    await c.step('reconnect')
    await c.quiet()
    expect(c.server.writes).toBe(1)
  } finally {
    await c.close()
  }
})
