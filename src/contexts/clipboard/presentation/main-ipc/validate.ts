import type { WriteClipboardTextInput } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

export function normalizeWriteClipboardTextPayload(payload: unknown): WriteClipboardTextInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for clipboard:write-text',
    })
  }

  const record = payload as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text : null

  if (typeof text !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'clipboard:write-text requires a string text value',
    })
  }

  return { text }
}
