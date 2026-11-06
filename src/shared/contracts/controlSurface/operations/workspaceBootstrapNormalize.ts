import { createAppError } from '../../../errors/appError'

export function normalizeBootstrapInput<T extends object>(input: T): T {
  const result = { ...input }
  for (const key of Object.keys(result) as (keyof T)[]) {
    const value = result[key]
    if (value === undefined) {
      continue
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw createAppError('common.invalid_input', { debugMessage: `Invalid ${String(key)}.` })
    }
    result[key] = value.trim() as T[keyof T]
  }
  return result
}
