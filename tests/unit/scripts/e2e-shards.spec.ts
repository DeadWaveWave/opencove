// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { planShards, validatePlan, fileFilter } from '../../../scripts/lib/e2e-shards.mjs'
import { shardBaselineFixture } from './fixtures/e2e-shard-baseline'
import { shardInvocation } from '../../../scripts/plan-e2e-shards.mjs'

const id = (file: string, title = 'case') => `tests/e2e/${file}.spec.ts › ${title}`
const file = (name: string) => `tests/e2e/${name}.spec.ts`

describe('duration-weighted E2E shards', () => {
  it('uses LPT on whole files, with stable path and shard-index tie breaks', () => {
    const ids = [id('a', 'one'), id('a', 'two'), id('b'), id('c'), id('d')]
    const baseline = Object.fromEntries(ids.map((key, i) => [key, [4, 4, 7, 6, 5][i]]))
    const plan = planShards(ids, baseline, 2)
    expect(plan.shards.map(s => s.files)).toEqual([
      [file('a'), file('d')],
      [file('b'), file('c')],
    ])
    expect(plan.shards.map(s => s.estimatedMs)).toEqual([13, 13])
    expect(planShards([...ids].reverse(), baseline, 2)).toEqual(plan)
    expect(planShards([id('b'), id('a')], {}, 2).shards[0].files).toEqual([file('a')])
  })

  it('estimates new tests/files using the positive OS median; ignores retired IDs as work', () => {
    const plan = planShards(
      [id('known'), id('new'), id('known', 'new')],
      {
        [id('known')]: 10,
        [id('old')]: 30,
        [id('skip')]: 0,
      },
      2,
    )
    expect(plan.defaultMs).toBe(20)
    expect(plan.unknownCases).toBe(2)
    expect(plan.shards.map(s => s.estimatedMs)).toEqual([30, 20])
    expect(planShards([id('new')], {}, 1).defaultMs).toBe(10000)
  })

  it('retains explicit platform-skipped zero-cost cases and distributes zero-cost files', () => {
    const ids = ['a.windows', 'b.windows', 'c.windows', 'd.windows'].map(name => id(name))
    const baseline = Object.fromEntries(ids.map(key => [key, 0]))
    const plan = planShards(ids, baseline, 3)
    expect(plan.shards.map(s => s.estimatedMs)).toEqual([0, 0, 0])
    expect(plan.shards.map(s => s.files.length)).toEqual([2, 1, 1])
    expect(plan.unknownCases).toBe(0)
    expect(() => validatePlan(ids, plan.shards, 3)).not.toThrow()
  })

  it('allows empty shards only when there are fewer files than shards', () => {
    const plan = planShards([id('a'), id('b')], {}, 4)
    expect(plan.shards.map(s => s.files.length)).toEqual([1, 1, 0, 0])
    expect(() => validatePlan([id('a'), id('b')], plan.shards, 4)).not.toThrow()
  })

  it('fails loudly on missing, duplicate, extra files, empty shards and wrong shard counts', () => {
    const ids = [id('a'), id('b'), id('c')]
    const plan = () => planShards(ids, {}, 2).shards
    const missing = plan()
    missing[0].files.pop()
    expect(() => validatePlan(ids, missing, 2)).toThrow(/missing/i)
    const duplicate = plan()
    duplicate[1].files.push(file('a'))
    expect(() => validatePlan(ids, duplicate, 2)).toThrow(/duplicate/i)
    const extra = plan()
    extra[0].files.push(file('unexpected'))
    expect(() => validatePlan(ids, extra, 2)).toThrow(/unexpected/i)
    const empty = plan()
    empty[0].files.push(...empty[1].files)
    empty[1].files = []
    expect(() => validatePlan(ids, empty, 2)).toThrow(/empty/i)
    expect(() => validatePlan(ids, plan(), 3)).toThrow(/count/i)
  })

  it('rejects invalid input instead of silently scheduling an incomplete suite', () => {
    for (const count of [0, -1, 1.5, NaN]) {
      expect(() => planShards([id('a')], {}, count)).toThrow()
    }
    expect(() => planShards([], {}, 3)).toThrow(/empty/i)
    expect(() => planShards([id('a'), id('a')], {}, 3)).toThrow(/duplicate/i)
    expect(() => planShards(['bad'], {}, 3)).toThrow(/ID/)
    for (const value of [-1, NaN, Infinity, null, '20']) {
      expect(() => planShards([id('a')], { [id('a')]: value }, 3)).toThrow(/duration/i)
    }
  })

  it('passes exact literal paths to Playwright, including regex punctuation and spaces', () => {
    const path = 'tests/e2e/nested/file [a]+.spec.ts'
    const pattern = new RegExp(fileFilter(path))
    expect(pattern.test(`/checkout/${path}`)).toBe(true)
    expect(pattern.test(`/checkout/${path}.extra`)).toBe(false)
    expect(pattern.test('/checkout/tests/e2e/nested/file aaaaXspecYts')).toBe(false)
  })

  it('routes files through the existing wrapper, preserving its environment and max-failures', () => {
    const plan = planShards([id('a'), id('b')], {}, 2)
    const env = {
      OPENCOVE_E2E_SKIP_BUILD: '1',
      OPENCOVE_E2E_WINDOW_MODE: 'inactive',
      OPENCOVE_E2E_RETRIES: '0',
      OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
      OPENCOVE_E2E_JSON_REPORT: 'artifacts/e2e-durations/ubuntu-1.json',
    }
    const invocation = shardInvocation(plan, 'ubuntu', 1, 2, env)
    expect(invocation?.args).toEqual(['test:e2e', '--', fileFilter(file('a')), '--max-failures=2'])
    expect(invocation?.env).toMatchObject(env)
    expect(JSON.parse(invocation!.env.OPENCOVE_E2E_SHARD_PLAN)).toEqual({
      os: 'ubuntu',
      current: 1,
      total: 2,
      estimatedMs: 10000,
      files: [file('a')],
    })
    expect(shardInvocation(plan, 'macos', 1, undefined, {}).args).not.toContain('--max-failures=2')
  })

  it('never runs the full suite for an empty shard or an invalid shard selection', () => {
    const plan = planShards([id('a')], {}, 2)
    expect(shardInvocation(plan, 'macos', 2, undefined)).toBeNull()
    expect(() => shardInvocation(plan, 'macos', 0, undefined)).toThrow(/index/)
    expect(() => shardInvocation(plan, 'macos', 1, -1)).toThrow(/max-failures/)
  })

  it.each(['macos', 'ubuntu'])('balances the real %s baseline fixture within 10%%', os => {
    const { ids, baseline } = shardBaselineFixture(os)
    const plan = planShards(ids, baseline, 3)
    expect(ids.some(caseId => Object.hasOwn(baseline, caseId))).toBe(true)
    expect(plan.shards.flatMap(s => s.files)).toHaveLength(
      new Set(ids.map(caseId => caseId.split(' › ')[0])).size,
    )
    const costs = plan.shards.map(s => s.estimatedMs)
    expect(Math.max(...costs) / Math.min(...costs)).toBeLessThan(1.1)
    expect(planShards([...ids].reverse(), baseline, 3)).toEqual(plan)
    expect(() => validatePlan(ids, plan.shards, 3)).not.toThrow()
  })
})
