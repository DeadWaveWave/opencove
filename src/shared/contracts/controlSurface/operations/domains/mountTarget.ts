import { defineLegacyOperation } from '../defineOperation'
export const mountTargetResolveOperation = defineLegacyOperation({
  id: 'mountTarget.resolve',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query mount Target resolve.',
})
export const mountTargetOperations = [mountTargetResolveOperation] as const
