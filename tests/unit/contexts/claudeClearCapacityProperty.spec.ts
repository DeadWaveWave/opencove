// @vitest-environment node
import { expect, it } from 'vitest'
import {
  CLEAR_SEEDS,
  capacityCases,
  minimizeClearCase,
  type ClearCase,
} from '../../support/claudeClearProperty/cases'
import { runClearCase } from '../../support/claudeClearProperty/run'
for (const seed of CLEAR_SEEDS) {
  it(`preserves capacity safety and liveness for seed ${seed}`, async () => {
    let failed = 0,
      unsafe = 0,
      lockout = 0,
      steps = 0,
      first: ClearCase | undefined
    for (const value of capacityCases(seed)) {
      // oxlint-disable-next-line no-await-in-loop -- invocation-local fixture and exact delivery order
      const result = await runClearCase(value)
      steps += result.steps
      if (result.errors.length) {
        failed++
        first ??= value
      }
      if (result.errors.some(e => !e.reason.includes('lockout'))) unsafe++
      if (result.errors.some(e => e.reason.includes('lockout'))) lockout++
    }
    process.stdout.write(
      JSON.stringify({ seed, capacitySequences: 30, steps, failed, unsafe, lockout }) + '\n',
    )
    const minimal = first
      ? await minimizeClearCase(first, async value => (await runClearCase(value)).errors.length > 0)
      : undefined
    expect(
      failed,
      JSON.stringify(
        { minimal, evidence: minimal ? await runClearCase(minimal) : undefined },
        null,
        2,
      ),
    ).toBe(0)
  }, 120000)
}
it('crosses twice each journal bound with histories, receipts, unknown captures and tied Starts', () => {
  const all = CLEAR_SEEDS.flatMap(capacityCases)
  expect(all).toHaveLength(150)
  expect(all.some(c => c.events.filter(e => e.id === 'A' && e.name === 'Stop').length >= 256)).toBe(
    true,
  )
  expect(all.some(c => c.events.filter(e => e.id === 'B' && e.name === 'Stop').length >= 256)).toBe(
    true,
  )
  expect(all.some(c => c.events.filter(e => e.kind === 'capture').length >= 128)).toBe(true)
  expect(
    all.some(c => c.events.filter(e => e.name === 'SessionStart' && e.at === 110).length === 2),
  ).toBe(true)
})
