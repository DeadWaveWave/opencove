import { expect, it } from 'vitest'
import { toCompactNodeData } from '../../../src/contexts/workspace/application/nodeControl/nodeDtos'

it.each([
  ['agent', 'agent'],
  [' agent ', 'agent'],
  [undefined, null],
])(
  'task link summaries expose the task-owned pointer, including legacy absence (%s)',
  (linkedAgentNodeId, expected) => {
    expect(toCompactNodeData({ kind: 'task', task: { linkedAgentNodeId } })).toMatchObject({
      kind: 'task',
      linkedAgentNodeId: expected,
    })
  },
)
it('task link summaries never promote an agent taskId into a reverse task link', () => {
  expect(
    toCompactNodeData({ kind: 'agent', task: { taskId: 'stale', linkedAgentNodeId: 'stale' } }),
  ).toEqual({ kind: 'agent' })
})
