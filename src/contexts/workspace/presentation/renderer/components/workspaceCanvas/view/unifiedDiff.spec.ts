import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './unifiedDiff'

describe('parseUnifiedDiff', () => {
  it('parses unified diffs into files with line numbers', () => {
    const diff = [
      'diff --git a/foo.txt b/foo.txt',
      'index 1111111..2222222 100644',
      '--- a/foo.txt',
      '+++ b/foo.txt',
      '@@ -1,2 +1,3 @@',
      ' line1',
      '-line2',
      '+line2 changed',
      '+line3',
      '',
    ].join('\n')

    const parsed = parseUnifiedDiff(diff)
    expect(parsed.files).toHaveLength(1)

    const file = parsed.files[0]!
    expect(file.path).toBe('foo.txt')
    expect(file.addedLines).toBe(2)
    expect(file.deletedLines).toBe(1)
    expect(file.hunks).toHaveLength(1)

    const hunk = file.hunks[0]!
    expect(hunk.header).toBe('@@ -1,2 +1,3 @@')

    expect(hunk.lines).toEqual([
      { type: 'context', content: 'line1', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'del', content: 'line2', oldLineNumber: 2, newLineNumber: null },
      { type: 'add', content: 'line2 changed', oldLineNumber: null, newLineNumber: 2 },
      { type: 'add', content: 'line3', oldLineNumber: null, newLineNumber: 3 },
    ])
  })
})
