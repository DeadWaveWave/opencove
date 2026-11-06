import { defineLegacyOperation } from '../defineOperation'
export const noteCreateOperation = defineLegacyOperation({
  id: 'note.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Persist a note with text and geometry in the specified space',
})
export const noteOperations = [noteCreateOperation] as const
