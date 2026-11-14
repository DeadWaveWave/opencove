// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  AgentProcessOwnership,
  observeRetirementProcesses,
} from '@platform/process/ptyHost/agentProcessOwnership'
import type { ProcessIdentity } from '@platform/process/ptyHost/posixProcessTable'

const row = (pid: number, parentPid = 1, startTime = `birth-${pid}`): ProcessIdentity => ({
  pid,
  parentPid,
  pgid: pid,
  startTime,
  command: 'fixture',
})
function captured() {
  const owner = new AgentProcessOwnership(vi.fn())
  owner.add('agent', 10)
  owner.observe([row(10), row(20, 10)], ['agent'], true)
  return owner
}

it.each([null, { rows: [], complete: false }])(
  'represents failed or incomplete absence as unknown, never an empty proof: %j',
  sample => {
    const owner = captured()
    const observation = observeRetirementProcesses(sample)
    expect(observation.kind).toBe('unknown')
    expect(owner.retirementState('agent', observation, [])).toEqual({ kind: 'unknown' })
  },
)

it('requires a captured launch identity even when a later complete sample is empty', () => {
  const owner = new AgentProcessOwnership(vi.fn())
  owner.add('agent', 10)
  const empty = observeRetirementProcesses({ rows: [], complete: true })
  expect(owner.retirementState('agent', empty, [])).toEqual({ kind: 'unknown' })
  owner.abandonCapture(['agent'])
  owner.observe([row(10, 1, 'replacement')], ['agent'], true)
  expect(owner.retirementState('agent', empty, [])).toEqual({ kind: 'unknown' })
  expect(owner.retirementState('unowned', empty, [])).toEqual({ kind: 'unknown' })
})

it('does not treat an exit notification as proof that the captured root disappeared', () => {
  const owner = captured()
  owner.noteExit('agent')
  const current = observeRetirementProcesses({ rows: [row(10)], complete: true })
  expect(owner.retirementState('agent', current, [])).toEqual({ kind: 'active' })
})

it('checks lifetime and retirement-only descendants even after the captured root is gone', () => {
  const owner = captured()
  expect(
    owner.retirementState(
      'agent',
      observeRetirementProcesses({ rows: [row(20)], complete: true }),
      [],
    ),
  ).toEqual({ kind: 'active' })
  expect(
    owner.retirementState(
      'agent',
      observeRetirementProcesses({ rows: [row(999)], complete: true }),
      [row(999)],
    ),
  ).toEqual({ kind: 'active' })
})

it('proves absence using birth identity without adopting recycled roots or members', () => {
  const owner = captured()
  const current = observeRetirementProcesses({
    rows: [row(10, 1, 'replacement'), row(20, 1, 'replacement'), row(30, 10)],
    complete: true,
  })
  expect(owner.retirementState('agent', current, [row(20)])).toEqual({ kind: 'proven-empty' })
})
