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
    spawnedByNodeId: z.string().trim().min(1).nullish(),
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
    'node.not_found',
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
export const nodeManagedClaudeBindingOperation = defineOperation({
  id: 'node.managedClaudeBinding',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read the saved Claude binding before or after its canvas node is saved',
  input: z.strictObject({
    nodeId: z.string().trim().min(1).max(256).describe('Agent node whose saved binding is read'),
  }),
  errors: ['persistence.unavailable'],
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
export const nodeResolveCallerSelectorOperation = defineOperation({
  id: 'node.resolveCallerSelector',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Resolve the caller’s parent node from authenticated creation lineage',
  input: z.strictObject({
    selector: z.literal('@parent'),
    expectedCallerNodeId: z.string().trim().min(1).optional(),
  }),
  errors: [
    'node.parent_unavailable',
    'node.not_found',
    'persistence.unavailable',
    'persistence.invalid_state',
  ],
})
export const nodeOperations = [
  nodeManagedClaudeBindingOperation,
  nodeResolveCallerSelectorOperation,
  nodeCreateOperation,
  nodeDeleteOperation,
  nodeGetOperation,
  nodeListOperation,
  nodeUpdateOperation,
] as const
