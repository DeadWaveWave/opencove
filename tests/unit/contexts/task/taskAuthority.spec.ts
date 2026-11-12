import { describe, expect, it } from 'vitest'
import {
  appendText,
  claimTask,
  releaseTask,
  replaceText,
  transitionTask,
} from '@contexts/task/domain/taskAuthority'
import type { TaskAuthorityRecord } from '@shared/contracts/taskAuthority'

const task = (): TaskAuthorityRecord => ({
  nodeId: 'task',
  projectId: 'project',
  kind: 'task',
  generation: 'generation',
  version: 1,
  retired: false,
  text: '',
  textVersion: 1,
  status: 'todo',
  linkedAgentNodeId: null,
  claim: null,
  claimNote: null,
  claimGeneration: 0,
  lastRunAt: null,
  agentSessions: [],
  legacyConflict: null,
})
const acquire = (record = task(), holderNodeId = 'holder') =>
  claimTask(record, {
    holderNodeId,
    leaseId: 'lease',
    acquiredAt: '2026-11-12T00:00:00.000Z',
    note: 'progress',
    holderBusy: false,
  })

describe('task authority transitions', () => {
  it('acquires the complete tuple without changing the original', () => {
    const before = task()
    expect(acquire(before)).toMatchObject({
      status: 'doing',
      linkedAgentNodeId: 'holder',
      claim: { holderNodeId: 'holder', leaseId: 'lease' },
      claimGeneration: 1,
      version: 2,
    })
    expect(before.status).toBe('todo')
  })
  it('checks closed and held state before same-holder no-op or stale todo', () => {
    const held = acquire()
    expect(() => acquire({ ...held, status: 'done' })).toThrowError(
      expect.objectContaining({ code: 'task.closed' }),
    )
    expect(() => acquire({ ...held, status: 'todo' }, 'other')).toThrowError(
      expect.objectContaining({ code: 'task.claimed' }),
    )
    expect(
      claimTask(held, {
        holderNodeId: 'holder',
        leaseId: 'new',
        acquiredAt: 'later',
        note: 'new',
        holderBusy: true,
      }),
    ).toBe(held)
  })
  it('rejects a busy holder before acquisition', () => {
    expect(() =>
      claimTask(task(), {
        holderNodeId: 'holder',
        leaseId: 'new',
        acquiredAt: 'now',
        note: null,
        holderBusy: true,
      }),
    ).toThrowError(expect.objectContaining({ code: 'task.holder_busy' }))
  })
  it('fences release/reacquisition ABA and retains history', () => {
    const released = releaseTask(acquire(), 'lease')
    expect(released).toMatchObject({
      status: 'todo',
      linkedAgentNodeId: null,
      claim: null,
      claimNote: null,
      claimGeneration: 2,
    })
    const again = claimTask(released, {
      holderNodeId: 'holder',
      leaseId: 'new',
      acquiredAt: 'now',
      note: null,
      holderBusy: false,
    })
    expect(() => releaseTask(again, 'lease')).toThrowError(
      expect.objectContaining({ code: 'task.stale' }),
    )
  })
  it('requires a lease to complete and human authority to reopen', () => {
    const held = acquire()
    expect(() => transitionTask(held, 'doing', null, true)).toThrow()
    expect(() => transitionTask(held, 'todo', 'lease', true)).toThrow()
    expect(() => transitionTask(held, 'done', 'lease', false)).toThrowError(
      expect.objectContaining({ code: 'common.forbidden' }),
    )
    const closed = transitionTask(held, 'ai_done', 'lease', false)
    expect(closed).toMatchObject({ status: 'ai_done', claim: null, linkedAgentNodeId: 'holder' })
    expect(() => acquire(closed)).toThrowError(expect.objectContaining({ code: 'task.closed' }))
    expect(transitionTask(closed, 'todo', null, true)).toMatchObject({
      status: 'todo',
      claim: null,
      linkedAgentNodeId: null,
    })
  })
})

describe('versioned note text', () => {
  it.each([
    ['', '', ''],
    ['', 'first', 'first'],
    ['one', 'two', 'one\ntwo'],
    ['one\n', ' two\n', 'one\n two\n'],
    ['one', '-', 'one\n-'],
  ])('appends %j and %j preserving whitespace', (current, input, expected) => {
    const before = { ...task(), kind: 'note' as const, text: current }
    const result = appendText(before, input)
    expect(result.text).toBe(expected)
    expect(result.textVersion).toBe(input ? 2 : 1)
    if (!input) {
      expect(result).toBe(before)
    }
  })
  it('fences stale replacement after append and preserves Unicode', () => {
    const note = appendText({ ...task(), kind: 'note' }, '你好 🌊')
    expect(() => replaceText(note, 'old', 1)).toThrowError(
      expect.objectContaining({ code: 'task.text_stale' }),
    )
    expect(replaceText(note, '新', 2)).toMatchObject({ text: '新', textVersion: 3 })
  })
  it('limits final UTF-8 bytes but permits oversized no-op and shrink', () => {
    const note = { ...task(), kind: 'note' as const, text: '界'.repeat(350000) }
    expect(appendText(note, '')).toBe(note)
    expect(replaceText(note, note.text, 1)).toBe(note)
    expect(replaceText(note, 'small', 1).text).toBe('small')
    expect(() => appendText(note, 'x')).toThrowError(
      expect.objectContaining({ code: 'task.text_too_large' }),
    )
  })
})
