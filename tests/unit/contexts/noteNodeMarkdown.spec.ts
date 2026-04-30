import { describe, expect, it, vi } from 'vitest'
import {
  joinFileSystemPath,
  normalizeMarkdownFileName,
  saveNoteAsMarkdownFile,
} from '../../../src/contexts/workspace/presentation/renderer/components/NoteNode.markdown'

describe('note node markdown export', () => {
  it('normalizes markdown file names', () => {
    expect(normalizeMarkdownFileName('Meeting notes')).toBe('Meeting notes.md')
    expect(normalizeMarkdownFileName('already.md')).toBe('already.md')
    expect(normalizeMarkdownFileName('bad/name:*?')).toBe('bad-name---.md')
    expect(normalizeMarkdownFileName('con')).toBe('note-con.md')
    expect(normalizeMarkdownFileName('   ')).toBeNull()
  })

  it('joins POSIX and Windows directory paths', () => {
    expect(joinFileSystemPath('/tmp/project/', 'note.md')).toBe('/tmp/project/note.md')
    expect(joinFileSystemPath('C:\\Users\\me\\project\\', 'note.md')).toBe(
      'C:\\Users\\me\\project\\note.md',
    )
  })

  it('writes note content as markdown text', async () => {
    const writeFileText = vi.fn().mockResolvedValue(undefined)

    await expect(
      saveNoteAsMarkdownFile({
        filesystemApi: { writeFileText },
        directoryPath: '/tmp/project',
        fileName: 'note.md',
        text: '# Hello',
      }),
    ).resolves.toBe('/tmp/project/note.md')

    expect(writeFileText).toHaveBeenCalledWith({
      uri: 'file:///tmp/project/note.md',
      content: '# Hello',
    })
  })
})
