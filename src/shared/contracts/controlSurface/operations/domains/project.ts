import { defineLegacyOperation } from '../defineOperation'
export const projectListOperation = defineLegacyOperation({
  id: 'project.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query project list.',
})
export const projectOperations = [projectListOperation] as const
