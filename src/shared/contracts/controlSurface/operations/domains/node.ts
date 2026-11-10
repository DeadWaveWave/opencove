import {
  nodeCreateInput,
  nodeUpdateInput,
  normalizeNodeCreateInput,
  nodeSpaceLocator,
} from './nodeInputs'
import { withStrictInput } from './nodeInputValidation'
import {
  normalizeDeletePayload,
  normalizeGetPayload,
  normalizeListPayload,
  normalizeUpdatePayload,
} from '../nodeQueriesNormalize'
import { defineOperation } from '../defineOperation'
import * as z from 'zod'
const nodeIdInput = z.strictObject({ nodeId: z.string() })
const nodeListInput = z
  .strictObject({
    space: nodeSpaceLocator.nullish(),
    projectId: z.unknown().optional(),
    kind: z.unknown().optional(),
  })
  .nullish()

export const nodeCreateOperation = defineOperation({
  id: 'node.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a canvas node, launching an agent or terminal when requested',
  input: nodeCreateInput,
  normalize: normalizeNodeCreateInput,
  legacyNormalize: withStrictInput(nodeCreateInput, normalizeNodeCreateInput),
  errors: [
    'space.not_found',
    'space.ambiguous',
    'agent.launch_failed',
    'agent.managed_launch_rejected',
    'agent.managed_launch_commit_failed',
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
  input: nodeIdInput,
  normalize: normalizeDeletePayload,
  legacyNormalize: withStrictInput(nodeIdInput, normalizeDeletePayload),
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
  input: nodeIdInput,
  normalize: normalizeGetPayload,
  legacyNormalize: withStrictInput(nodeIdInput, normalizeGetPayload),
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
  input: nodeListInput,
  normalize: normalizeListPayload,
  legacyNormalize: withStrictInput(nodeListInput, normalizeListPayload),
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
  summary: 'Rename or resize a canvas node, or edit note, task or website content',
  input: nodeUpdateInput,
  normalize: normalizeUpdatePayload,
  legacyNormalize: withStrictInput(nodeUpdateInput, normalizeUpdatePayload),
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
