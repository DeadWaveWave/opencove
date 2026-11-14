// @vitest-environment node
import { expect, it } from 'vitest'
import { runClearCase } from '../../support/claudeClearProperty/run'
import type { ClearEvent } from '../../support/claudeClearProperty/cases'

it.each(['working', 'waiting', 'user'] as const)(
  'keeps pre-clear current captures live after settlement: %s',
  async kind => {
    const events: ClearEvent[] = [
      { kind: 'hook', epoch: 0, id: 'A', name: 'UserPromptSubmit', at: 20 },
      { kind: 'hook', epoch: 0, id: 'A', name: 'Stop', at: 70 },
      { kind: 'capture', epoch: 1, id: 'B', at: 80 },
      { kind: 'hook', epoch: 0, id: 'A', name: 'SessionEnd', at: 90 },
      { kind: 'hook', epoch: 1, id: 'B', name: 'SessionStart', at: 110 },
      { kind: 'tick', epoch: 1, id: 'B', at: 199, ms: 201 },
      { kind: kind === 'user' ? 'user' : 'file', name: kind, epoch: 1, id: 'B', at: 250 },
    ]
    const result = await runClearCase({
      seed: 0,
      index: 0,
      ids: ['A', 'B'],
      events,
      equivalent: false,
    })
    expect(result.errors, JSON.stringify(result)).toEqual([])
    expect(result.output.ready).toBe(false)
  },
)
