import { describe, expect, it } from 'vitest'
import { normalizeReadFileBytesResult } from '../../../src/shared/contracts/dto/filesystemBytes'

describe('normalizeReadFileBytesResult', () => {
  it('keeps Uint8Array payloads intact', () => {
    const bytes = new Uint8Array([1, 2, 3])

    const result = normalizeReadFileBytesResult({ bytes }, 'filesystem.readFileBytes')

    expect(result.bytes).toEqual(bytes)
  })

  it('restores array payloads into Uint8Array', () => {
    const result = normalizeReadFileBytesResult({ bytes: [1, 2, 3] }, 'filesystem.readFileBytes')

    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('restores JSON-serialized typed arrays into Uint8Array', () => {
    const result = normalizeReadFileBytesResult(
      { bytes: { 0: 4, 1: 5, 2: 6 } },
      'filesystem.readFileBytes',
    )

    expect(result.bytes).toEqual(new Uint8Array([4, 5, 6]))
  })

  it('rejects invalid byte payloads', () => {
    expect(() =>
      normalizeReadFileBytesResult({ bytes: { nope: 'bad' } }, 'filesystem.readFileBytes'),
    ).toThrow('Invalid payload for filesystem.readFileBytes bytes object.')
  })
})
