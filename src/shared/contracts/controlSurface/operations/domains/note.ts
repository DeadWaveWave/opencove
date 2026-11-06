import { defineLegacyOperation } from '../defineOperation'
export const noteCreateOperation = defineLegacyOperation({
  id: 'note.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform note create.',
})
export const noteOperations = [noteCreateOperation] as const
