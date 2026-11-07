import { spaceLocatorWire, nodeFrameWire } from '../nodeWire'
import {
  normalizeDeletePayload,
  normalizeGetPayload,
  normalizeListPayload,
  normalizeUpdatePayload,
} from '../nodeQueriesNormalize'
import { defineOperation } from '../defineOperation'
import * as z from 'zod'
import { normalizeCreatePayload } from '../nodeNormalize'
export const nodeCreateOperation = defineOperation({
  id: 'node.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a canvas node, launching an agent or terminal when requested',
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
export const nodeDeleteOperation = defineOperation({
  id: 'node.delete',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Delete a canvas node and clean up its runtime',
  // Keep legacy rejection diagnostics and validation ordering unchanged.
  input: z.looseObject({ nodeId: z.string() }),
  normalize: normalizeDeletePayload,
  legacyNormalize: normalizeDeletePayload,
  errors: [
    'node.not_found',
    'persistence.unavailable',
    'persistence.invalid_state',
    'persistence.io_failed',
  ],
})
export const nodeGetOperation = defineOperation({
  id: 'node.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get a canvas node with its owning project and space',
  // Keep legacy rejection diagnostics and validation ordering unchanged.
  input: z.looseObject({ nodeId: z.string() }),
  normalize: normalizeGetPayload,
  legacyNormalize: normalizeGetPayload,
  errors: [
    'node.not_found',
    'persistence.unavailable',
    'persistence.invalid_state',
    'persistence.io_failed',
  ],
})
export const nodeListOperation = defineOperation({
  id: 'node.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List canvas nodes filtered by project, space or kind',
  // Keep legacy rejection diagnostics and validation ordering unchanged.
  input: z
    .looseObject({
      space: spaceLocatorWire.nullish(),
      // Legacy optionalString maps non-strings to null.
      projectId: z.unknown().optional(),
      // Legacy readable-kind accepts String(value), including ['plugin'], unchanged.
      kind: z.unknown().optional(),
    })
    .nullish(),
  normalize: normalizeListPayload,
  legacyNormalize: normalizeListPayload,
  errors: [
    'space.not_found',
    'space.ambiguous',
    'worker.unavailable',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
    'worktree.list_worktrees_failed',
    'persistence.unavailable',
    'persistence.invalid_state',
    'persistence.io_failed',
  ],
})
export const nodeUpdateOperation = defineOperation({
  id: 'node.update',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Update a note, task or website node title, frame or content',
  // Keep legacy rejection diagnostics and validation ordering unchanged.
  input: z.looseObject({
    // agent/terminal reach normalize to retain node.unsupported_operation.
    kind: z.enum(['note', 'task', 'website', 'agent', 'terminal']),
    nodeId: z.string(),
    // Legacy optionalString maps non-strings to null.
    title: z.unknown().optional(),
    frame: nodeFrameWire.nullish(),
    // Legacy data is opaque and passed through unchanged, except nullish defaults.
    data: z.unknown().optional(),
  }),
  normalize: normalizeUpdatePayload,
  legacyNormalize: normalizeUpdatePayload,
  errors: [
    'node.not_found',
    'node.unsupported_operation',
    'persistence.unavailable',
    'persistence.invalid_state',
    'persistence.io_failed',
  ],
})
export const nodeOperations = [
  nodeCreateOperation,
  nodeDeleteOperation,
  nodeGetOperation,
  nodeListOperation,
  nodeUpdateOperation,
] as const
