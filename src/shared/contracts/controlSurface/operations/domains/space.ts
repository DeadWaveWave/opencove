import { defineLegacyOperation } from '../defineOperation'
export const spaceCreateChildOperation = defineLegacyOperation({
  id: 'space.createChild',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform space create Child.',
})
export const spaceGetOperation = defineLegacyOperation({
  id: 'space.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query space get.',
})
export const spaceListOperation = defineLegacyOperation({
  id: 'space.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query space list.',
})
export const spaceOperations = [
  spaceCreateChildOperation,
  spaceGetOperation,
  spaceListOperation,
] as const
