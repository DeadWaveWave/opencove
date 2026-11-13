// @vitest-environment node
import { expect, it } from 'vitest'
import { runClearCase } from '../../support/claudeClearProperty/run'
import type { ClearEvent } from '../../support/claudeClearProperty/cases'

const hook = (epoch: number, id: string, name: string, at: number): ClearEvent => ({
  epoch,
  id,
  name,
  at,
  kind: 'hook',
})
const quiet = (epoch = 1, id = 'B', ms = 201): ClearEvent => ({
  epoch,
  id,
  kind: 'tick',
  at: 999,
  ms,
})
const cases: { name: string; ids: string[]; events: ClearEvent[] }[] = [
  {
    name: 'pending capture generations retain unmatched user input',
    ids: ['A', 'B', 'C', 'C'],
    events: [
      hook(1, 'B', 'SessionEnd', 190),
      { epoch: 2, id: 'C', kind: 'capture', at: 194 },
      { epoch: 2, id: 'C', kind: 'file', name: 'working', at: 240 },
      hook(1, 'B', 'SessionStart', 110),
      { epoch: 2, id: 'C', kind: 'user', at: 225 },
      hook(3, 'C', 'Stop', 370),
      hook(2, 'C', 'SessionStart', 210),
    ],
  },
  {
    name: 'unmatched successor IO revokes a completed predecessor receipt',
    ids: ['A', 'B', 'C'],
    events: [
      hook(1, 'B', 'SessionStart', 110),
      hook(1, 'B', 'UserPromptSubmit', 120),
      hook(1, 'B', 'Stop', 170),
      { epoch: 2, id: 'C', kind: 'user', at: 225 },
    ],
  },
  {
    name: 'unattached ended predecessor cannot pin a fresh successor',
    ids: ['A', 'B', 'C'],
    events: [hook(1, 'B', 'SessionEnd', 190), hook(2, 'C', 'SessionStart', 210), quiet(2, 'C')],
  },
  {
    name: 'all adopted events fold before completion publication',
    ids: ['A', 'B'],
    events: [
      hook(1, 'B', 'Stop', 170),
      hook(1, 'B', 'UserPromptSubmit', 120),
      hook(1, 'B', 'PermissionRequest', 130),
      hook(1, 'B', 'SessionStart', 110),
      quiet(),
    ],
  },
  {
    name: 'adopted completed turns leave the transition immediately',
    ids: ['A', 'B'],
    events: [
      hook(1, 'B', 'UserPromptSubmit', 120),
      hook(1, 'B', 'Stop', 170),
      hook(1, 'B', 'SessionStart', 110),
      hook(1, 'B', 'PermissionRequest', 130),
      quiet(),
    ],
  },
  {
    name: 'expired lifecycle evidence survives reordered reused-ID starts',
    ids: ['A', 'B', 'C', 'C'],
    events: [
      hook(3, 'C', 'SessionEnd', 390),
      quiet(3, 'C', 2100),
      hook(3, 'C', 'SessionStart', 310),
      hook(3, 'C', 'Stop', 370),
      hook(2, 'C', 'SessionStart', 210),
    ],
  },
  {
    name: 'fresh authenticated clear recovers after orphan expiry',
    ids: ['A', 'B', 'C', 'D'],
    events: [
      hook(1, 'B', 'SessionStart', 110),
      hook(2, 'C', 'UserPromptSubmit', 220),
      quiet(2, 'C', 2100),
      hook(3, 'D', 'SessionStart', 310),
      quiet(3, 'D'),
    ],
  },
  {
    name: 'current Stop retains live identity without fabricating a turn',
    ids: ['A', 'B'],
    events: [hook(1, 'B', 'SessionStart', 110), hook(1, 'B', 'Stop', 170), quiet()],
  },
  {
    name: 'pending repeated-ID callbacks belong to the latest delivered Start',
    ids: ['A', 'B', 'B'],
    events: [
      hook(1, 'B', 'SessionStart', 110),
      hook(2, 'B', 'SessionStart', 210),
      { epoch: 1, id: 'B', kind: 'user', at: 125 },
      hook(2, 'B', 'Stop', 270),
    ],
  },
  {
    name: 'transcript positions cannot prove predecessor time',
    ids: ['A', 'B', 'C'],
    events: [{ epoch: 2, id: 'C', kind: 'user', at: 225 }, hook(2, 'C', 'SessionStart', 310)],
  },
  {
    name: 'late stale Submit cannot confirm current transcript input',
    ids: ['A', 'B', 'C', 'C'],
    events: [
      hook(3, 'C', 'SessionStart', 310),
      { epoch: 2, id: 'C', kind: 'user', at: 225 },
      hook(2, 'C', 'UserPromptSubmit', 220),
    ],
  },
  {
    name: 'idle file observations preserve an existing clear receipt',
    ids: ['A', 'B'],
    events: [
      hook(1, 'B', 'SessionStart', 110),
      quiet(),
      { epoch: 1, id: 'B', kind: 'file', name: 'idle', at: 260 },
    ],
  },
  {
    name: 'passive pre-clear notifications do not poison the attachment watermark',
    ids: ['A', 'A', 'A'],
    events: [
      hook(2, 'A', 'Notification', 235),
      hook(2, 'A', 'SessionStart', 210),
      hook(2, 'A', 'Stop', 270),
    ],
  },
  {
    name: 'post-End completion waits for its repeated-ID successor Start',
    ids: ['A', 'B', 'B'],
    events: [
      hook(1, 'B', 'SessionEnd', 190),
      hook(1, 'B', 'UserPromptSubmit', 120),
      hook(2, 'B', 'Stop', 270),
      hook(1, 'B', 'Stop', 170),
      hook(1, 'B', 'SessionStart', 110),
      hook(2, 'B', 'SessionStart', 210),
    ],
  },
  {
    name: 'proven predecessor identity releases only its temporary input pin',
    ids: ['A', 'B', 'C'],
    events: [
      hook(2, 'C', 'SessionStart', 210),
      quiet(2, 'C'),
      { epoch: 1, id: 'B', kind: 'user', at: 285 },
      hook(1, 'B', 'SessionStart', 110),
    ],
  },
  {
    name: 'newer idle file sample rejects an older working callback',
    ids: ['A', 'B'],
    events: [
      { epoch: 1, id: 'B', kind: 'capture', at: 80 },
      hook(0, 'A', 'SessionEnd', 90),
      { epoch: 1, id: 'B', kind: 'file', name: 'idle', at: 160 },
      { epoch: 1, id: 'B', kind: 'file', name: 'working', at: 140 },
      hook(1, 'B', 'SessionStart', 110),
    ],
  },
  {
    name: 'completed pre-clear history prevents replaying an ignored older Submit',
    ids: ['A', 'B', 'C', 'C'],
    events: [
      hook(3, 'C', 'UserPromptSubmit', 320),
      hook(2, 'C', 'UserPromptSubmit', 220),
      hook(3, 'C', 'Stop', 370),
      hook(0, 'A', 'PermissionRequest', 130),
      hook(2, 'C', 'SessionStart', 210),
    ],
  },
  {
    name: 'older same-ID Start proof preserves issued capture tokens and withdraws clear-only authority',
    ids: ['A', 'B', 'C', 'C'],
    events: [
      hook(3, 'C', 'SessionStart', 310),
      { epoch: 2, id: 'C', kind: 'file', name: 'idle', at: 260 },
      hook(2, 'C', 'SessionStart', 210),
      { epoch: 2, id: 'C', kind: 'user', at: 225 },
      hook(3, 'C', 'Stop', 370),
    ],
  },
  {
    name: 'settled namespace rejects an old unknown watcher after recovery',
    ids: ['A', 'B', 'C', 'R'],
    events: [
      { epoch: 2, id: 'C', kind: 'capture', at: 80 },
      hook(0, 'A', 'SessionEnd', 90),
      quiet(0, 'A', 2100),
      hook(3, 'R', 'SessionStart', 10000),
      quiet(3, 'R'),
      { epoch: 2, id: 'C', kind: 'user', at: 225 },
    ],
  },
  {
    name: 'ended namespace retains successor IO before its delayed Start even after quiet',
    ids: ['A', 'B'],
    events: [
      { epoch: 1, id: 'B', kind: 'capture', at: 80 },
      hook(0, 'A', 'SessionEnd', 90),
      quiet(0, 'A'),
      { epoch: 1, id: 'B', kind: 'file', name: 'working', at: 140 },
      hook(1, 'B', 'SessionStart', 110),
    ],
  },
]
it.each(cases)('$name', async ({ ids, events }) => {
  expect(
    (await runClearCase({ seed: 0, index: 0, ids, events, equivalent: false })).errors,
  ).toEqual([])
})
