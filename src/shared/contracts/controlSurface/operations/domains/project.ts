import * as z from 'zod'
import { normalizeBootstrapInput } from '../workspaceBootstrapNormalize'
import { defineOperation } from '../defineOperation'
export const projectListOperation = defineOperation({
  id: 'project.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List persisted projects and identify the active project',
  input: z.union([
    z.looseObject({}),
    // This no-argument query accepts and preserves any payload, including non-JSON numbers.
    z.unknown(),
  ]),
  normalize: (payload: unknown) => payload ?? null,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: (payload: unknown) => payload ?? null,
  errors: ['persistence.unavailable'],
})

export const projectAddOperation = defineOperation({
  id: 'project.add',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Add a local directory as a project with its default mount and space',
  input: z.object({ path: z.string(), name: z.string().optional() }),
  normalize: input => normalizeBootstrapInput(input),
  errors: ['persistence.invalid_state', 'persistence.io_failed', 'persistence.unavailable'],
})

export const projectOperations = [projectAddOperation, projectListOperation] as const
