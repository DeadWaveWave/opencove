import { defineLegacyOperation } from '../defineOperation'
export const canvasFocusOperation = defineLegacyOperation({
  id: 'canvas.focus',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform canvas focus.',
})
export const canvasOperations = [canvasFocusOperation] as const
