// @vitest-environment node
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ClaudeLiveConversation } from '../../../src/contexts/agent/application/ClaudeLiveConversation'
import { ClaudeConversationLifecycle } from '../../../src/contexts/agent/domain/ClaudeConversationLifecycle'
import { extractClaudeBaseline } from '../../../scripts/lib/claude-baseline.mjs'
import { resolveDifferentialBaseline } from '../../../scripts/lib/differential-baseline.mjs'
import * as current from '../../support/claudeNonClear/api'
import { runCorpus, type Api } from '../../support/claudeNonClear/runCorpus'
import { FUZZ_SEEDS, fuzzCases, minimizeCase } from '../../support/claudeNonClear/fuzz'
import type { Case } from '../../support/claudeNonClear/corpus'

const requested = resolveDifferentialBaseline(process.env.OPENCOVE_DIFFERENTIAL_BASELINE)
if (!requested.enabled) {
  process.stdout.write(`${requested.reason}\n`)
  it.skip(requested.reason, () => {})
} else {
  describe(`Claude differential verification against ${requested.commit}`, () => {
    let baseline: Api
    let temporary: string
    let candidate: Api = current
    let candidateTemporary: string | undefined
    beforeAll(async () => {
      const extracted = extractClaudeBaseline(requested.commit)
      temporary = extracted.temporary
      baseline = await import(/* @vite-ignore */ resolve(temporary, 'entry.ts'))
      if (process.env.OPENCOVE_NON_CLEAR_CANDIDATE_REF) {
        candidateTemporary = extractClaudeBaseline(
          process.env.OPENCOVE_NON_CLEAR_CANDIDATE_REF,
        ).temporary
        candidate = await import(/* @vite-ignore */ resolve(candidateTemporary, 'entry.ts'))
      }
    }, 30000)
    afterAll(() => {
      if (temporary) {
        rmSync(temporary, { recursive: true, force: true })
      }
      if (candidateTemporary) {
        rmSync(candidateTemporary, { recursive: true, force: true })
      }
    })

    it.each(FUZZ_SEEDS)(
      'matches the requested baseline for 1000 non-clear sequences, seed %i',
      async seed => {
        const spies = [
          vi.spyOn(ClaudeConversationLifecycle.prototype, 'checkpoint'),
          ...(
            [
              'accept',
              'accepts',
              'deferTranscript',
              'veto',
              'followOrdinary',
              'synchronize',
              'dispose',
            ] as const
          ).map(name => vi.spyOn(ClaudeLiveConversation.prototype, name)),
        ]
        const differs = async (scenario: Case) => {
          const expected = await runCorpus(baseline, scenario)
          const actual = await runCorpus(candidate, scenario)
          return !isDeepStrictEqual(actual, expected)
        }
        let count = 0
        let first: Case | undefined
        try {
          for (const scenario of fuzzCases(seed)) {
            // oxlint-disable-next-line no-await-in-loop -- registry/fake timers are invocation-local
            if (await differs(scenario)) {
              count++
              first ??= scenario
            }
          }
          const minimal = first ? await minimizeCase(first, differs) : undefined
          let checkpoint: unknown
          if (minimal) {
            const expected = await runCorpus(baseline, minimal)
            const actual = await runCorpus(candidate, minimal)
            const index = expected.findIndex(
              (value, position) => !isDeepStrictEqual(value, actual[position]),
            )
            checkpoint = { index, expected: expected[index], actual: actual[index] }
          }
          expect(
            count,
            JSON.stringify({ seed, differed: count, minimal, checkpoint }, null, 2),
          ).toBe(0)
          for (const spy of spies) {
            expect(spy).not.toHaveBeenCalled()
          }
        } finally {
          for (const spy of spies) {
            spy.mockRestore()
          }
        }
      },
      120000,
    )

    it('covers the promised non-clear event and provenance classes with fixed seeds', () => {
      const cases = FUZZ_SEEDS.flatMap(fuzzCases)
      expect(cases).toHaveLength(5000)
      expect(new Set(cases.map(value => !!value.terminal))).toEqual(new Set([true, false]))
      const steps = cases.flatMap(value => value.steps)
      const hooks = steps.filter(step => step.kind === 'hook')
      expect(new Set(hooks.map(step => step.name))).toEqual(
        new Set([
          'SessionStart',
          'UserPromptSubmit',
          'Stop',
          'PermissionRequest',
          'Notification',
          'SessionEnd',
        ]),
      )
      expect(
        new Set(hooks.filter(step => step.name === 'SessionStart').map(step => step.source)),
      ).toEqual(new Set(['startup', 'resume', 'compact']))
      expect(steps.some(step => step.kind === 'file' && step.generation === 0)).toBe(true)
      expect(steps.some(step => step.kind === 'file' && step.generation === 89)).toBe(true)
      expect(hooks.some(step => (step.stampOffset ?? 0) < 0)).toBe(true)
      expect(cases.some(value => value.transcriptIO)).toBe(true)
      expect(steps.some(step => step.kind === 'timeout' && step.ms > 5000)).toBe(true)
      expect(
        new Set(steps.filter(step => step.kind === 'transcript').map(step => step.variant)),
      ).toEqual(
        new Set([
          'user',
          'assistant',
          'metadata',
          'identified-metadata',
          'local-command',
          'command-markup',
          'enqueue',
          'remove',
        ]),
      )
      expect(
        cases.filter(
          value =>
            value.steps.filter(step => step.kind === 'hook' && step.source === 'resume').length >
            64,
        ),
      ).toHaveLength(160)
    })
  })
}
