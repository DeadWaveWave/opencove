import { expect, it } from 'vitest'
import { mergePersistedNode } from '@shared/sync/mergePersistedNode'
import type { NormalizedPersistedNodeContract } from '@shared/contracts/normalizedPersistedAppState'
import { projectOwnedTaskFields } from '@shared/sync/taskAuthorityProjection'

const canonical = {
  id: 'task',
  kind: 'task',
  position: { x: 10, y: 20 },
  task: {
    requirement: 'Shared',
    priority: 'medium',
    tags: [],
    status: 'doing',
    linkedAgentNodeId: 'holder',
    claim: { holderNodeId: 'holder', leaseId: 'lease', acquiredAt: 'now' },
    claimNote: 'Current',
    claimGeneration: 3,
    agentSessions: [],
    lastRunAt: 'now',
    legacyConflict: null,
    taskAuthority: { generation: 'generation', version: 4, textVersion: 1 },
  },
} as unknown as NormalizedPersistedNodeContract
const stale = {
  ...canonical,
  position: { x: 700, y: 20 },
  task: {
    ...canonical.task,
    requirement: 'Local edit',
    status: 'todo',
    linkedAgentNodeId: null,
    claim: null,
    taskAuthority: { generation: 'forged', version: 999, textVersion: 999 },
  },
} as unknown as NormalizedPersistedNodeContract

it.each([true, false])(
  'projects the accepted tuple last with ancestor=%s and preserves unrelated edits',
  ancestor => {
    const merged = mergePersistedNode(canonical, stale, ancestor ? canonical : null)
    expect(merged.position.x).toBe(700)
    expect(merged.task).toMatchObject({
      requirement: 'Local edit',
      status: 'doing',
      linkedAgentNodeId: 'holder',
      claim: { leaseId: 'lease' },
      taskAuthority: { version: 4, generation: 'generation' },
    })
  },
)
it('does not establish authority from the proposed object', () => {
  const unowned = { kind: 'task', task: { requirement: 'old' } }
  const projected = projectOwnedTaskFields(unowned, stale)
  expect(projected.task).not.toHaveProperty('taskAuthority')
  expect(projected.task).not.toHaveProperty('claim')
  expect(projected.task).toMatchObject({ requirement: 'Local edit', status: 'todo' })
  expect(stale.task).toHaveProperty('taskAuthority')
})
it('projects note text without replacing local geometry', () => {
  const saved = {
    kind: 'note',
    task: {
      text: 'Accepted\nAppend',
      taskAuthority: { generation: 'g', version: 2, textVersion: 2 },
    },
  }
  expect(
    projectOwnedTaskFields(saved, { kind: 'note', position: { x: 700 }, task: { text: 'Draft' } }),
  ).toEqual({
    kind: 'note',
    position: { x: 700 },
    task: saved.task,
  })
})
