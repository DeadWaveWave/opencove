import { defineLegacyOperation, defineOperation } from '../defineOperation'
import * as z from 'zod'
import { normalizeCreatePayload } from '../nodeNormalize'
export const nodeCreateOperation = defineOperation({
  id: 'node.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a canvas node.',
  input: z.object({
    kind: z.enum(['note', 'task', 'website', 'agent', 'terminal']),
    space: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('spaceId'), spaceId: z.string() }),
        z.object({
          kind: z.literal('spaceName'),
          name: z.string(),
          projectId: z.unknown().optional(),
        }),
        z.object({
          kind: z.literal('workerBranch'),
          worker: z.string(),
          branch: z.string(),
          projectId: z.unknown().optional(),
        }),
        z.object({
          kind: z.literal('workerPath'),
          worker: z.string(),
          path: z.string(),
          projectId: z.unknown().optional(),
        }),
      ])
      .nullish(),
    projectId: z.unknown().optional(),
    title: z.unknown().optional(),
    frame: z
      .object({
        x: z.number().nullish(),
        y: z.number().nullish(),
        width: z.number().nullish(),
        height: z.number().nullish(),
      })
      .nullish(),
    data: z.unknown().optional(),
  }),
  normalize: normalizeCreatePayload,
  errors: [
    'space.not_found',
    'space.ambiguous',
    'agent.launch_failed',
    'terminal.spawn_failed',
    'worker.unavailable',
    'terminal.runtime_not_ready',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
    'worktree.list_worktrees_failed',
    'persistence.unavailable',
    'persistence.invalid_state',
    'persistence.io_failed',
  ],
})
export const nodeDeleteOperation = defineLegacyOperation({
  id: 'node.delete',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform node delete.',
})
export const nodeGetOperation = defineLegacyOperation({
  id: 'node.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query node get.',
})
export const nodeListOperation = defineLegacyOperation({
  id: 'node.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query node list.',
})
export const nodeUpdateOperation = defineLegacyOperation({
  id: 'node.update',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform node update.',
})
export const nodeOperations = [
  nodeCreateOperation,
  nodeDeleteOperation,
  nodeGetOperation,
  nodeListOperation,
  nodeUpdateOperation,
] as const
