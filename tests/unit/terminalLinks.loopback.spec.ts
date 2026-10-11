import { describe, expect, it } from 'vitest'
import { isTerminalLoopbackHost } from '../../src/contexts/terminal/domain/links/terminalLoopbackHost'
describe('terminal URL runtime-local hosts', () => {
  it('covers browser-normalized IPv4, IPv6 and local names', () => {
    for (const host of [
      '127.0.0.2',
      '127.255.4.8',
      '0.0.0.0',
      '[::]',
      '[::1]',
      '[::ffff:7f00:1]',
      'localhost',
      'app.localhost',
      'localhost.',
    ]) {
      expect(isTerminalLoopbackHost(host)).toBe(true)
    }
    for (const host of [
      'example.com',
      'mylocalhost',
      '128.0.0.1',
      '192.168.1.1',
      '[2001:db8::1]',
    ]) {
      expect(isTerminalLoopbackHost(host)).toBe(false)
    }
  })
})
