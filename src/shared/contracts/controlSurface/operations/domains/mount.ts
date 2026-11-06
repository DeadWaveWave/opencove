import { defineLegacyOperation } from '../defineOperation'
export const mountCreateOperation = defineLegacyOperation({
  id: 'mount.create',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform mount create.',
})
export const mountListOperation = defineLegacyOperation({
  id: 'mount.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query mount list.',
})
export const mountPromoteOperation = defineLegacyOperation({
  id: 'mount.promote',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform mount promote.',
})
export const mountRemoveOperation = defineLegacyOperation({
  id: 'mount.remove',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform mount remove.',
})
export const mountOperations = [
  mountCreateOperation,
  mountListOperation,
  mountPromoteOperation,
  mountRemoveOperation,
] as const
