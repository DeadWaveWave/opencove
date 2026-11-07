import { createAppError } from './appError'

export function invalidPromptField(field: string, message: string, hint: string): never {
  throw createAppError('common.invalid_input', {
    details: { issues: [{ path: [field], message, hint }] },
  })
}
