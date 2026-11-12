// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createControlToken } from '../../../src/app/main/controlSurface/http/createControlToken'

it('preserves all 256 random bits in a token safe for a separate CLI argument', () => {
  const bytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index))
  bytes[0] = 0xf8
  expect(bytes.toString('base64url')).toMatch(/^-/)
  const random = vi.fn(() => bytes)

  const token = createControlToken(random)

  expect(random).toHaveBeenCalledExactlyOnceWith(32)
  expect(token).not.toMatch(/^-/)
  expect(token).toMatch(/^[0-9a-f]{64}$/)
  expect(Buffer.from(token, 'hex')).toEqual(bytes)
})
