import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import {
  sessionFinalMessageOperation,
  sessionFinalMessageForNodeOperation,
  sessionGetOperation,
  sessionKillOperation,
} from '../../../src/shared/contracts/controlSurface/operations/domains/session'

describe('session address schemas', () => {
  it.each([sessionGetOperation, sessionFinalMessageOperation, sessionKillOperation])(
    '$id exports fields and normalizes exclusive addresses',
    operation => {
      const schema = z.toJSONSchema(operation.input)
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(['nodeId', 'sessionId'])
      expect(schema.required ?? []).toEqual([])
      for (const field of ['sessionId', 'nodeId']) {
        expect(schema.properties?.[field]).toMatchObject({
          type: 'string',
          description: expect.any(String),
        })
      }
      expect(operation.normalize(operation.input.parse({ sessionId: ' legacy ' }))).toEqual({
        sessionId: 'legacy',
      })
      expect(operation.normalize(operation.input.parse({ nodeId: ' node ' }))).toEqual({
        nodeId: 'node',
      })
      expect(() => operation.normalize({ sessionId: 'legacy', nodeId: 'node' })).toThrow()
      expect(() => operation.normalize({})).toThrow()
      expect(operation.errors).toContain('session.not_found')
    },
  )
})

// Replace the sessionId-only migration parity corpus with the intentional address contract.
const invalidValues: unknown[] = [undefined, null, false, true, 0, -1, 1.5, NaN, Infinity, [], {}]
const validIds = ['session-1', ' session-1 ', '\t session-1\n', '-flag', 'x'.repeat(100000)]
const addressOperations = [sessionGetOperation, sessionFinalMessageOperation, sessionKillOperation]
describe.each(addressOperations)('$id address compatibility', operation => {
  const surface = createControlSurface()
  const handled: unknown[] = []
  registerOperation(surface, operation, {
    handle: (_ctx, payload) => {
      handled.push(payload)
      return payload
    },
    defaultErrorCode: 'common.unexpected',
  })
  const invoke = (payload: unknown) =>
    surface.invoke({} as ControlSurfaceContext, { id: operation.id, kind: operation.kind, payload })

  it.each(['sessionId', 'nodeId'])('trims %s and discards unrelated fields', async field => {
    const before = handled.length
    const results = await Promise.all(validIds.map(value => invoke({ [field]: value, extra: 1 })))
    results.forEach((result, index) => {
      expect(result).toMatchObject({
        ok: true,
        value: { [field]: validIds[index].trim() },
      })
    })
    expect(handled.slice(before)).toEqual(validIds.map(value => ({ [field]: value.trim() })))
  })

  it('rejects malformed payloads, missing, blank and competing addresses before dispatch', async () => {
    const payloads = [
      ...invalidValues,
      '',
      ' ',
      '\t\n',
      '-flag',
      'x'.repeat(100000),
      ' hello ',
      Object.assign([], { sessionId: 'session-1' }),
      { sessionId: 'session-1', nodeId: 'node-1' },
      ...['sessionId', 'nodeId'].flatMap(field =>
        [...invalidValues, '', ' ', '\t\n'].map(value => ({ [field]: value })),
      ),
      { sessionId: 'session-1', nodeId: null },
      { sessionId: null, nodeId: 'node-1' },
    ]
    const before = handled.length
    const results = await Promise.all(payloads.map(invoke))
    for (const result of results) {
      expect(result).toMatchObject({
        __opencoveControlEnvelope: true,
        ok: false,
        error: { code: 'common.invalid_input' },
      })
    }
    expect(handled).toHaveLength(before)
  })
})

it('exports and validates the internal strict transcript query', () => {
  const operation = sessionFinalMessageForNodeOperation
  expect(z.toJSONSchema(operation.input).properties).toHaveProperty('sessionId')
  expect(operation.input.safeParse({}).success).toBe(false)
  expect(operation.input.safeParse({ sessionId: 'id', nodeId: 'node' }).success).toBe(false)
  expect(operation.normalize(operation.input.parse({ sessionId: ' id ' }))).toEqual({
    sessionId: 'id',
  })
  expect(() => operation.normalize({ sessionId: ' ' })).toThrow()
  expect(operation.errors).toContain('session.transcript_not_ready')
  expect(operation.scope).toBe('interact')
})
