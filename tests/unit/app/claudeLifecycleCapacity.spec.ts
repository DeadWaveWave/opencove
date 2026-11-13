// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import { capacityWrites } from './claudeClearCapacity.helpers'
it.each([0, 123])(
  'keeps End-dependent successor activity with %s current permission receipts',
  async count => {
    const f = await clearIngressFixture(false)
    try {
      await f.send('B', 'SessionStart', 20, undefined, 'clear')
      await f.send('B', 'SessionEnd', 30, undefined, undefined, { reason: 'clear' })
      await f.send('B', 'UserPromptSubmit', 50, 'successor')
      await f.send('C', 'SessionStart', 40, undefined, 'clear')
      await vi.advanceTimersByTimeAsync(201)
      for (let n = 0; n < count; n++) {
        // oxlint-disable-next-line no-await-in-loop -- authenticated evidence crosses actual capacity
        await f.send('C', 'PermissionRequest', 60 + n, 'current')
      }
      await f.send('C', 'Stop', 200, 'current')
      expect(await capacityWrites(f)).toBe(0)
    } finally {
      await f.close()
    }
  },
)
it.each([10, 260])('withholds empty readiness for reused A after %s clears', async count => {
  const f = await clearIngressFixture(false)
  try {
    for (let n = 0; n < count; n++) {
      // oxlint-disable-next-line no-await-in-loop -- distinct authenticated lifecycle history
      await f.send(`C${n}`, 'SessionStart', 100 + n, undefined, 'clear')
      // oxlint-disable-next-line no-await-in-loop -- quiet must never supply identity freshness
      await vi.advanceTimersByTimeAsync(201)
    }
    await f.send('A', 'SessionStart', 1000, undefined, 'clear')
    await vi.advanceTimersByTimeAsync(201)
    expect(await capacityWrites(f)).toBe(0)
    // A fresh ordinary resume also exercises main's classifier for a still-retained ID.
    await f.send('A', 'SessionStart', 1001, undefined, 'resume')
    await f.send('A', 'UserPromptSubmit', 1002, 'fresh')
    await f.send('A', 'Stop', 1003, 'fresh')
    expect(await capacityWrites(f)).toBe(2)
  } finally {
    await f.close()
  }
})
