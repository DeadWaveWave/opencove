import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveE2ERetries } from '../../../scripts/lib/e2e-retries.mjs'

const rootDir = resolve(import.meta.dirname, '../../..')

describe('resolveE2ERetries', () => {
  it.each([
    [undefined, 0],
    ['', 0],
    ['   ', 0],
    ['0', 0],
    ['2', 2],
    [' 3 ', 3],
    ['-1', 0],
    ['x', 0],
    ['1.5', 0],
  ])('maps OPENCOVE_E2E_RETRIES=%j to %i', (rawValue, expected) => {
    expect(resolveE2ERetries(rawValue)).toBe(expected)
  })

  it('is the only retry rule used by the three Playwright configs', async () => {
    for (const name of [
      'playwright.config.ts',
      'playwright.web-canvas.config.ts',
      'playwright.web-shell.config.ts',
    ]) {
      const source = await readFile(resolve(rootDir, name), 'utf8')
      expect(source, name).toContain('resolveE2ERetries(process.env.OPENCOVE_E2E_RETRIES)')
      expect(source, name).toContain('scripts/lib/e2e-retries.mjs')
      expect(source, name).not.toMatch(/function resolve(E2E)?Retries/)
      expect(source, name).not.toMatch(/process\.env\.CI\s*\?/)
    }
  })
})
