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
      unsafe = 0,
      lockout = 0,
      firstKind: string | undefined,
      steps = 0,
      conservativeRefusals = 0,
      conservativeDeliveries = 0,
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
      conservativeRefusals += actual.conservativeRefusals
      conservativeDeliveries += actual.conservativeDeliveries
      if (actual.errors.length || actual.divergent) {
        failures++
        first ??= scenario
        firstKind ??=
          (
            actual.errors.find(e => e.reason.includes('unsafe admission')) ?? actual.errors[0]
          )?.reason.split(':')[0] ?? 'final divergence'
      }
      if (actual.errors.some(e => !e.reason.includes('lockout'))) {
        unsafe++
      }
      if (actual.errors.some(e => e.reason.includes('lockout'))) {
        lockout++
      }
      if (actual.divergent) {
        divergent++
        if (new Set(scenario.ids).size !== scenario.ids.length) {
          sameIdDivergent++
        }
      }
    }
    process.stdout.write(
      `${JSON.stringify({ seed, sequences: 1000, steps, failures, divergent, unsafe, lockout, conservativeRefusals, conservativeDeliveries })}\n`,
    )
    const minimal = first
      ? await minimizeClearCase(first, async value => {
          const result = await check(value)
          return firstKind === 'final divergence'
            ? result.divergent
            : result.errors.some(e => e.reason.startsWith(firstKind!))
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
  expect(cases.some(c => c.ids[0] === c.ids[1])).toBe(true)
  expect(cases.some(c => c.events.some(e => e.duplicate))).toBe(true)
  expect(cases.some(c => c.events.some(e => e.kind === 'tick' && e.ms! > 2000))).toBe(true)
  for (const activity of [
    'UserPromptSubmit',
    'PermissionRequest',
    'working',
    'waiting',
    'metadata',
    'user',
  ]) {
    expect(
      cases.some(c => {
        const at = c.events.findIndex(
          e => e.epoch === 1 && (e.name === activity || e.kind === activity),
        )
        const start = c.events.findIndex(e => e.epoch === 1 && e.name === 'SessionStart')
        const end = c.events.findIndex(e => e.epoch === 0 && e.name === 'SessionEnd')
        return at >= 0 && at < start && at < end
      }),
      `first-clear pre-lifecycle ${activity}`,
    ).toBe(true)
  }
})

for (const seed of CLEAR_SEEDS) {
  it(`recovers after quiet for 100 fresh namespace probes, seed ${seed}`, async () => {
    let failures = 0,
      unsafe = 0,
      lockout = 0,
      first: ClearCase | undefined
    for (const value of clearCases(seed).slice(0, 100)) {
      const epoch = value.ids.length
      const scenario: ClearCase = {
        ...value,
        equivalent: false,
        ids: [...value.ids, 'R'],
        events: [
          ...value.events,
          { epoch: epoch + 1, id: 'U', kind: 'capture', at: 9990 },
          { epoch, id: 'R', kind: 'hook', name: 'SessionStart', at: 10000 },
          { epoch, id: 'R', kind: 'tick', at: 10099, ms: 201 },
          { epoch: epoch + 1, id: 'U', kind: 'user', at: 10025 },
        ],
      }
      // oxlint-disable-next-line no-await-in-loop -- each prefix owns its registry and model
      const actual = await runClearCase(scenario)
      if (actual.errors.length) {
        failures++
        first ??= scenario
      }
      if (actual.errors.some(e => !e.reason.includes('lockout'))) {
        unsafe++
      }
      if (actual.errors.some(e => e.reason.includes('lockout'))) {
        lockout++
      }
    }
    process.stdout.write(
      `${JSON.stringify({ seed, recoverySequences: 100, failures, unsafe, lockout })}\n`,
    )
    const minimal = first
      ? await minimizeClearCase(first, async value => (await runClearCase(value)).errors.length > 0)
      : undefined
    expect(
      failures,
      JSON.stringify(
        { minimal, evidence: minimal ? await runClearCase(minimal) : undefined },
        null,
        2,
      ),
    ).toBe(0)
  }, 120000)
}
