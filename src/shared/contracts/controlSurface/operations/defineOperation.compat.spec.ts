import * as z from 'zod'
import { describe, expect, it } from 'vitest'
import { defineLegacyOperation, defineOperation } from './defineOperation'

// `pnpm check` type-checks this file: it fails when one of the `@ts-expect-error` lines below
// stops failing, that is when a legacy hook can again be declared without a registry entry.

const meta = {
  id: 'typecheck.compat',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Compile-time check only.',
} as const

describe('compat anchors on operation definitions', () => {
  it('accepts a legacy hook together with a registry id and keeps the id off the operation', () => {
    const operation = defineOperation({
      ...meta,
      input: z.string(),
      errors: [],
      normalize: value => value,
      legacyNormalize: value => value,
      compat: 'control-surface-legacy-validation',
    })
    expect(operation.legacyNormalize).toBeTypeOf('function')
    expect('compat' in operation).toBe(false)
    expect(Object.isFrozen(operation)).toBe(true)

    const legacy = defineLegacyOperation({ ...meta, compat: 'control-surface-legacy-validation' })
    expect('compat' in legacy).toBe(false)
    expect(legacy).toEqual({ ...meta, contract: 'legacy' })
  })

  it('rejects a legacy hook without a registry id at compile time', () => {
    // @ts-expect-error legacyNormalize needs a compat id
    defineOperation({
      ...meta,
      input: z.string(),
      errors: [],
      normalize: value => value,
      legacyNormalize: value => value,
    })
    // @ts-expect-error defineLegacyOperation needs a compat id
    defineLegacyOperation(meta)
  })

  it('rejects an id that is not in compatRegistry.json at compile time', () => {
    // @ts-expect-error compat must name an id from compatRegistry.json
    defineOperation({
      ...meta,
      input: z.string(),
      errors: [],
      normalize: value => value,
      legacyNormalize: value => value,
      compat: 'no-such-entry',
    })
    // @ts-expect-error compat must name an id from compatRegistry.json
    defineLegacyOperation({ ...meta, compat: 'no-such-entry' })
  })
})
