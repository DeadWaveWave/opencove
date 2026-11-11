import { expect, it } from 'vitest'
import { createResultFiles } from '../lib/result-files.mjs'
it('retains a compact rule result as one file', () => {
  const rows = [{ file: 'src/contexts/workspace/a.ts' }]
  expect(createResultFiles('rule.jsonl', rows)).toEqual([
    { filename: 'rule.jsonl', violations: rows },
  ])
})
it('splits large generated results by owning source area', () => {
  const workspace = Array.from({ length: 300 }, () => ({ file: 'src/contexts/workspace/a.ts' }))
  const settings = Array.from({ length: 201 }, () => ({ file: 'src/contexts/settings/a.ts' }))
  const files = createResultFiles('rule.jsonl', [...workspace, ...settings])
  expect(files.map(entry => entry.filename)).toEqual([
    'rule.src-contexts-settings.jsonl',
    'rule.src-contexts-workspace.jsonl',
  ])
  expect(files.flatMap(entry => entry.violations)).toHaveLength(501)
  expect(files.every(entry => entry.violations.length <= 500)).toBe(true)
})
it('bounds a growing single area without losing findings', () => {
  const rows = Array.from({ length: 1001 }, () => ({ file: 'src/contexts/workspace/a.ts' }))
  const files = createResultFiles('rule.jsonl', rows)
  expect(files.map(entry => entry.violations.length)).toEqual([500, 500, 1])
  expect(new Set(files.map(entry => entry.filename)).size).toBe(3)
})
