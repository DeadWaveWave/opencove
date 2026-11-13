// @vitest-environment node
import { expect, it } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import {
  CLEAR_SEEDS,
  clearCases,
  minimizeClearCase,
  type ClearCase,
} from '../../support/claudeClearProperty/cases'
import { runClearCase } from '../../support/claudeClearProperty/run'

const canonical = (value: ClearCase) => ({
  ...value,
  events: [...value.events].sort((a, b) => a.at - b.at),
})
for (const seed of CLEAR_SEEDS) {
  it(`preserves clear safety for 1000 sequences, seed ${seed}`, async () => {
    let failures = 0,
      divergent = 0,
      steps = 0,
      sameIdDivergent = 0,
      first: ClearCase | undefined
    const check = async (value: ClearCase) => {
      const actual = await runClearCase(value)
      const expected = value.equivalent ? await runClearCase(canonical(value), false) : undefined
      return {
        ...actual,
        reference: expected?.output,
        divergent: expected !== undefined && !isDeepStrictEqual(actual.output, expected.output),
      }
    }
    for (const scenario of clearCases(seed)) {
      // oxlint-disable-next-line no-await-in-loop -- deterministic invocation-local state per case
      const actual = await check(scenario)
      steps += actual.steps
      if (actual.errors.length || actual.divergent) {
        failures++
        first ??= scenario
      }
      if (actual.divergent) {
        divergent++
        if (new Set(scenario.ids).size !== scenario.ids.length) {
          sameIdDivergent++
        }
      }
    }
    const minimal = first
      ? await minimizeClearCase(first, async value => {
          const result = await check(value)
          return result.errors.length > 0 || result.divergent
        })
      : undefined
    const evidence = minimal ? await check(minimal) : undefined
    expect(
      failures,
      JSON.stringify(
        { seed, sequences: 1000, steps, failures, divergent, sameIdDivergent, minimal, evidence },
        null,
        2,
      ),
    ).toBe(0)
  }, 120000)
}
it('generates complete conversation event sets, duplicates, same-ID clears and expiry', () => {
  const cases = CLEAR_SEEDS.flatMap(clearCases)
  expect(cases).toHaveLength(5000)
  for (const value of cases) {
    for (const epoch of value.ids.keys()) {
      const events = value.events.filter(e => e.epoch === epoch)
      for (const name of [
        'SessionStart',
        'UserPromptSubmit',
        'PermissionRequest',
        'Notification',
        'Stop',
        'SessionEnd',
      ]) {
        expect(events.some(e => e.name === name)).toBe(true)
      }
      expect(events.some(e => e.kind === 'metadata')).toBe(true)
      expect(events.some(e => e.kind === 'user')).toBe(true)
      for (const name of ['working', 'waiting', 'idle']) {
        expect(events.some(e => e.kind === 'file' && e.name === name)).toBe(true)
      }
    }
  }
  expect(cases.some(c => new Set(c.ids).size !== c.ids.length)).toBe(true)
  expect(cases.some(c => c.events.some(e => e.duplicate))).toBe(true)
  expect(cases.some(c => c.events.some(e => e.kind === 'tick' && e.ms! > 2000))).toBe(true)
})
