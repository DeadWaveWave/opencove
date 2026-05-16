import { describe, expect, it } from 'vitest'
import { normalizeMarkdownFileName } from '../../../src/contexts/workspace/presentation/renderer/components/NoteNode.markdown'

describe('note node markdown export', () => {
  it('normalizes markdown file names', () => {
    expect(normalizeMarkdownFileName('Meeting notes')).toBe('Meeting notes.md')
    expect(normalizeMarkdownFileName('already.md')).toBe('already.md')
    expect(normalizeMarkdownFileName('bad/name:*?')).toBe('bad-name---.md')
    expect(normalizeMarkdownFileName('con')).toBe('note-con.md')
    expect(normalizeMarkdownFileName('   ')).toBeNull()
  })
})
