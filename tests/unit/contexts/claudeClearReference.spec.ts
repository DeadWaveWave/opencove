import { expect, it } from 'vitest'
import { ClearReference } from '../../support/claudeClearProperty/reference'
import { runClearCase } from '../../support/claudeClearProperty/run'
import type { ClearEvent } from '../../support/claudeClearProperty/cases'

export const pendingWatcher = (name: string): ClearEvent[] => [
  { epoch: 0, id: 'A', kind: 'hook', name: 'UserPromptSubmit', at: 20 },
  { epoch: 0, id: 'A', kind: 'hook', name: 'Stop', at: 70 },
  { epoch: 1, id: 'B', kind: 'capture', at: 80 },
  { epoch: 0, id: 'A', kind: 'hook', name: 'SessionEnd', at: 90 },
  { epoch: 1, id: 'B', kind: 'file', name, at: 140 },
  { epoch: 1, id: 'B', kind: 'hook', name: 'SessionStart', at: 110 },
  { epoch: 1, id: 'B', kind: 'tick', at: 199, ms: 201 },
]
it.each(['working', 'waiting'])('independently rejects pending %s evidence', async name => {
  const model = new ClearReference()
  for (const e of pendingWatcher(name)) {
    model.consume(e, { generation: undefined, epoch: e.epoch })
  }
  expect(model.verdict()).toMatchObject({ id: 'B', receipt: false, due: false })
  const actual = await runClearCase({
    seed: 0,
    index: 0,
    ids: ['A', 'B'],
    events: pendingWatcher(name),
    equivalent: false,
  })
  expect(actual.errors).toEqual([])
})
it('grants an empty new-ID clear after quiet and ignores metadata, idle and retired callbacks', () => {
  const m = new ClearReference()
  m.consume({ epoch: 1, id: 'B', kind: 'hook', name: 'SessionStart', at: 110 })
  for (const e of [
    { epoch: 0, id: 'A', kind: 'file', name: 'working', at: 140 },
    { epoch: 1, id: 'B', kind: 'metadata', at: 115 },
    { epoch: 1, id: 'B', kind: 'file', name: 'idle', at: 160 },
  ] as ClearEvent[]) {
    m.consume(e, { generation: 0, epoch: e.epoch })
  }
  m.advance(201)
  expect(m.verdict()).toMatchObject({ id: 'B', receipt: true, due: true, retired: ['A'] })
})

it('orders authenticated Starts by relay time, independently of source labels', () => {
  const m = new ClearReference()
  m.consume({ epoch: 2, id: 'C', kind: 'hook', name: 'SessionStart', at: 900 })
  m.consume({ epoch: 1, id: 'B', kind: 'hook', name: 'SessionStart', at: 1000 })
  m.advance(201)
  expect(m.verdict()).toMatchObject({ id: 'B', latestAuthenticated: 'B', receipt: true, due: true })
})
it('rejects callback generation substitution without consulting any live fence', () => {
  const m = new ClearReference()
  m.consume({ epoch: 1, id: 'B', kind: 'hook', name: 'SessionStart', at: 110 })
  m.consume({ epoch: 1, id: 'B', kind: 'capture', at: 115 }, { epoch: 1, generation: 2 })
  m.consume(
    { epoch: 1, id: 'B', kind: 'file', name: 'working', at: 140 },
    { epoch: 1, generation: 1 },
  )
  m.advance(201)
  expect(m.verdict().receipt).toBe(true)
  m.consume(
    { epoch: 1, id: 'B', kind: 'file', name: 'working', at: 150 },
    { epoch: 1, generation: 2 },
  )
  expect(m.verdict().receipt).toBe(false)
})
it('retains a valid current callback independently of capture clock skew', () => {
  const m = new ClearReference()
  m.consume({ epoch: 1, id: 'B', kind: 'hook', name: 'SessionStart', at: 110 })
  m.advance(1000)
  m.consume({ epoch: 1, id: 'B', kind: 'capture', at: 115 }, { epoch: 1, generation: 2 })
  m.consume(
    { epoch: 1, id: 'B', kind: 'file', name: 'working', at: 140 },
    { epoch: 1, generation: 2 },
  )
  expect(m.verdict().receipt).toBe(false)
})
it.each([
  ['B', 'C'],
  ['C', 'B'],
])('keeps tied namespaces ambiguous in order %s then %s', (first, second) => {
  const model = new ClearReference()
  for (const [epoch, id] of [
    [1, first],
    [2, second],
  ] as const) {
    model.consume({ epoch, id, kind: 'hook', name: 'SessionStart', at: 110 })
  }
  model.advance(201)
  expect(model.verdict()).toMatchObject({
    receipt: false,
    due: false,
    ambiguous: true,
    latestAuthenticated: undefined,
  })
  expect(model.retired.has(first)).toBe(false)
  model.consume({ epoch: 3, id: 'D', kind: 'hook', name: 'SessionStart', at: 310 })
  model.advance(201)
  expect(model.verdict()).toMatchObject({
    receipt: true,
    due: true,
    latestAuthenticated: 'D',
    ambiguous: false,
  })
})
it('keeps post-End activity unresolved across a delayed successor identity', () => {
  const model = new ClearReference()
  for (const event of [
    { epoch: 1, id: 'B', kind: 'hook', name: 'SessionStart', at: 20 },
    { epoch: 1, id: 'B', kind: 'hook', name: 'SessionEnd', at: 30 },
    { epoch: 2, id: 'B', kind: 'hook', name: 'UserPromptSubmit', at: 50 },
    { epoch: 3, id: 'C', kind: 'hook', name: 'SessionStart', at: 40 },
    { epoch: 3, id: 'C', kind: 'hook', name: 'Stop', at: 200 },
  ] as ClearEvent[]) {
    model.consume(event)
  }
  model.advance(201)
  expect(model.verdict()).toMatchObject({ receipt: false, due: false, unresolved: true })
})
it('requires a current Stop after lifecycle-history truncation while retaining the flag', () => {
  const model = new ClearReference()
  for (let i = 0; i < 65; i++) {
    model.consume({ epoch: i + 1, id: `L${i}`, kind: 'hook', name: 'SessionStart', at: 20 + i })
  }
  model.advance(201)
  expect(model.verdict()).toMatchObject({ receipt: false, due: false, historyIncomplete: true })
  model.consume({ epoch: 65, id: 'L64', kind: 'hook', name: 'Stop', at: 100 })
  expect(model.verdict()).toMatchObject({
    receipt: true,
    due: true,
    historyIncomplete: true,
    clearAllowed: false,
  })
})

it('does not promote an identical pre-truncation Stop replay into new readiness evidence', () => {
  const model = new ClearReference()
  model.consume({ epoch: 1, id: 'A', kind: 'hook', name: 'SessionStart', at: 5000 })
  const old: ClearEvent = { epoch: 1, id: 'A', kind: 'hook', name: 'Stop', at: 5100 }
  model.consume(old)
  for (let i = 0; i < 65; i++) {
    model.consume({ epoch: i + 2, id: `old-${i}`, kind: 'hook', name: 'SessionStart', at: 20 + i })
  }
  model.consume({ ...old, duplicate: true })
  expect(model.verdict()).toMatchObject({ historyIncomplete: true, receipt: false, due: false })
  model.consume({ ...old, at: 5200 })
  expect(model.verdict()).toMatchObject({ historyIncomplete: true, receipt: true, due: true })
})
