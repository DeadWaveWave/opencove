import { describe, expect, it } from 'vitest'
import { parseCheckArgs } from '../lib/cli-args.mjs'

describe('architecture check command line', () => {
  it('defaults to an audit', () => {
    expect(parseCheckArgs([])).toMatchObject({
      mode: 'audit',
      format: 'text',
      updateRatchet: false,
    })
    expect(parseCheckArgs(['--mode', 'check']).mode).toBe('check')
    expect(parseCheckArgs(['--update-ratchet']).updateRatchet).toBe(true)
  })

  it('allows --config only for an audit', () => {
    expect(parseCheckArgs(['--mode', 'audit', '--config', 'x.json']).config).toBe('x.json')
    expect(() => parseCheckArgs(['--mode', 'check', '--config', 'x.json'])).toThrow(/--config/)
    expect(() => parseCheckArgs(['--update-ratchet', '--config', 'x.json'])).toThrow(/--config/)
  })

  it('has no baseline override and rejects unknown options and modes', () => {
    expect(() => parseCheckArgs(['--mode', 'check', '--ratchet', 'other.json'])).toThrow(
      /Unknown option --ratchet/,
    )
    expect(() => parseCheckArgs(['--mode', 'nope'])).toThrow(/--mode/)
    expect(() => parseCheckArgs(['--mode'])).toThrow(/requires a value/)
  })
})
