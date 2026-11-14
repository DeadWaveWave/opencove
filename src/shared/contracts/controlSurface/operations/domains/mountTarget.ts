import * as z from 'zod'
import { normalizeMountTargetResolve } from '../topologyHandlersNormalize'
import { defineOperation } from '../defineOperation'
export const mountTargetResolveOperation = defineOperation({
  input: z.object({
    mountId: z.string(),
  }),
  normalize: normalizeMountTargetResolve,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeMountTargetResolve,
  errors: [],
  id: 'mountTarget.resolve',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Resolve a mount to its endpoint and root directory',
})
export const mountTargetOperations = [mountTargetResolveOperation] as const
