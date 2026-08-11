import { describe, expect, it } from 'vitest'
import { parseOptionalManagedSshPort } from '../../../src/contexts/topology/domain/managedSshPort'

describe('parseOptionalManagedSshPort', () => {
  it.each(['', '   '])('classifies %j as empty', input => {
    expect(parseOptionalManagedSshPort(input)).toEqual({ state: 'empty', value: null })
  })

  it.each([
    ['1', 1],
    ['22', 22],
    [' 65535 ', 65_535],
  ])('classifies %j as port %i', (input, value) => {
    expect(parseOptionalManagedSshPort(input)).toEqual({ state: 'valid', value })
  })

  it.each(['abc', '0', '70000', '2 2', '22.5', '-1'])('classifies %j as invalid', input => {
    expect(parseOptionalManagedSshPort(input)).toEqual({ state: 'invalid', value: null })
  })
})
