// @vitest-environment node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { corpus } from '../../support/claudeNonClear/corpus'
import { runCorpus, type Api } from '../../support/claudeNonClear/runCorpus'

const baseline = process.env.OPENCOVE_NON_CLEAR_BASELINE
let api: Api
beforeAll(async () => {
  api = baseline
    ? await import(/* @vite-ignore */ resolve(baseline, 'entry.ts'))
    : await import('../../support/claudeNonClear/api')
})
// No behavioral exceptions. New private fields missing on main normalize to false/null in the harness.
export const intentionalDifferences: Record<string, string> = {}
it.each(corpus)('matches the reviewed non-clear golden: $id', async scenario => {
  const actual = await runCorpus(api, scenario)
  const path = resolve(
    baseline ? `${baseline}/results` : 'tests/fixtures/claude/non-clear/goldens',
    `${scenario.id}.json`,
  )
  if (baseline) {
    await mkdir(resolve(baseline, 'results'), { recursive: true })
    await writeFile(path, '[\n' + actual.map(row => JSON.stringify(row)).join(',\n') + '\n]\n')
  } else {
    const expected = JSON.parse(await readFile(path, 'utf8'))
    expect(actual).toEqual(expected)
  }
})
