import { describe, expect, it } from 'vitest'
import { normalizeInvokeRequest } from '../../../src/app/main/controlSurface/validate'
import { OpenCoveAppError } from '../../../src/shared/errors/appError'

describe('control surface invoke request validation', () => {
  it('normalizes a valid request', () => {
    const request = normalizeInvokeRequest({
      kind: 'query',
      id: 'system.ping',
      payload: null,
    })

    expect(request).toEqual({
      kind: 'query',
      id: 'system.ping',
      payload: null,
    })
  })

  it('rejects invalid kind', () => {
    expect(() => normalizeInvokeRequest({ kind: 'nope', id: 'x', payload: null })).toThrow(
      OpenCoveAppError,
    )
  })
})
