// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import { capacityWrites } from './claudeClearCapacity.helpers'
it.each([10, 70])('does not recertify a compacted Stop after %s clear Starts', async count => {
  const f = await clearIngressFixture(false)
  try {
    await f.send('B', 'SessionStart', 20, undefined, 'clear')
    await vi.advanceTimersByTimeAsync(201)
    await f.send('B', 'Stop', 500, 'old')
    for (let n = 0; n < count; n++) {
      // oxlint-disable-next-line no-await-in-loop -- actual authenticated distinct lifecycle receipts
      await f.send(`L${n}`, 'SessionStart', 100 + n, undefined, 'clear')
      // oxlint-disable-next-line no-await-in-loop -- settle the namespace before the next clear
      await vi.advanceTimersByTimeAsync(201)
    }
    await f.send('B', 'SessionStart', 400, undefined, 'clear')
    await vi.advanceTimersByTimeAsync(201)
    expect(await capacityWrites(f)).toBe(0)
    await f.send('B', 'Stop', 500, 'old')
    expect(await capacityWrites(f)).toBe(0)
    await f.send('B', 'SessionStart', 510, undefined, 'resume')
    await f.send('B', 'UserPromptSubmit', 520, 'fresh')
    await f.send('B', 'Stop', 530, 'fresh')
    expect(await capacityWrites(f)).toBe(2)
  } finally {
    await f.close()
  }
})
it('keeps a successor submission idempotent after its delayed clear Start settles', async () => {
  const f = await clearIngressFixture(false)
  try {
    await f.send('B', 'UserPromptSubmit', 120, 'first')
    await f.send('B', 'SessionStart', 110, undefined, 'clear')
    await vi.advanceTimersByTimeAsync(201)
    await f.send('B', 'UserPromptSubmit', 120, 'first')
    expect(await capacityWrites(f)).toBe(0)
    await f.send('B', 'Stop', 170, 'first')
    expect(f.fence().snapshot.lastEndedTurn?.outcome).toBe('completed')
    expect(await capacityWrites(f)).toBe(2)
  } finally {
    await f.close()
  }
})
