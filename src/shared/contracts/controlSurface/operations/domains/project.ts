import * as z from 'zod'
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
  legacyNormalize: (payload: unknown) => payload ?? null,
  errors: ['persistence.unavailable'],
})
export const projectOperations = [projectListOperation] as const
