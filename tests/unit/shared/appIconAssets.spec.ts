import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

// Branding changes should update both assets together instead of drifting per-platform.
const APPROVED_APP_ICON_HASHES = {
  'build/icon.png': 'ab5051c48c4b33f425ee9f1a1fd278bc9b3bd4fd673cc3bb9cf3d7be8610c857',
  'build/icon.ico': 'abb242e796c5af523f69f2f066316fedb0f1f0d746628665c1aa104174810767',
} as const

function sha256ForRepoFile(relativePath: string): string {
  const absolutePath = resolve(__dirname, '../../..', relativePath)
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
}

describe('app icon assets', () => {
  it('keeps the approved cross-platform branding assets checked in', () => {
    for (const [relativePath, expectedHash] of Object.entries(APPROVED_APP_ICON_HASHES)) {
      expect(sha256ForRepoFile(relativePath)).toBe(expectedHash)
    }
  })
})
