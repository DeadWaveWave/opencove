// @vitest-environment node
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  readBoundedDirectory,
  readBoundedText,
} from '../../../../src/contexts/filesystem/infrastructure/boundedFileReads'
import { normalizeFileReadLimit } from '../../../../src/contexts/filesystem/domain/fileReadLimits'
describe('bounded provider reads', () => {
  it('bounds the actual file handle reads and directory iteration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-plugin-files-'))
    try {
      await writeFile(join(root, 'small'), '你好')
      await writeFile(join(root, 'large'), 'x'.repeat(1025))
      await mkdir(join(root, 'directory'))
      expect(await readBoundedText(join(root, 'small'), 6)).toEqual({ content: '你好' })
      await expect(readBoundedText(join(root, 'small'), 5)).rejects.toThrow('limit')
      await expect(readBoundedText(join(root, 'large'), 1024)).rejects.toThrow('limit')
      await expect(readBoundedText(join(root, 'directory'), 1024)).rejects.toThrow('regular file')
      expect(await readBoundedDirectory(root, 2)).toMatchObject({
        entries: expect.any(Array),
        truncated: true,
      })
      expect((await readBoundedDirectory(root, 2)).entries).toHaveLength(2)
      expect(await readBoundedDirectory(root, 3)).toMatchObject({ truncated: false })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('preserves legacy absent limits and rejects invalid explicit limits', () => {
    expect(normalizeFileReadLimit(undefined, 10)).toBeUndefined()
    for (const value of [0, -1, 1.5, 11, '1', null]) {
      expect(() => normalizeFileReadLimit(value, 10)).toThrow()
    }
  })
})
