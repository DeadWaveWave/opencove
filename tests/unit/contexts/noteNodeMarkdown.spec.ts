import { describe, expect, it, vi } from 'vitest'
import {
  joinFileSystemPath,
  normalizeMarkdownFileName,
  resolveStickyNotesDirectoryPath,
  saveNoteAsMarkdownFile,
} from '../../../src/contexts/workspace/presentation/renderer/components/NoteNode.markdown'

describe('normalizeMarkdownFileName', () => {
  it('adds markdown extension and strips unsafe path characters', () => {
    expect(normalizeMarkdownFileName(' sprint/notes:today ')).toBe('sprint-notes-today.md')
  })

  it('keeps existing markdown extension and rejects blank input', () => {
    expect(normalizeMarkdownFileName('todo.MD')).toBe('todo.MD')
    expect(normalizeMarkdownFileName(' . ')).toBeNull()
  })

  it('avoids Windows reserved names', () => {
    expect(normalizeMarkdownFileName('con')).toBe('note-con.md')
  })
})

describe('saveNoteAsMarkdownFile', () => {
  it('creates the sticky directory before writing note text', async () => {
    const stat = vi.fn().mockRejectedValueOnce(new Error('missing'))
    const createDirectory = vi.fn().mockResolvedValue(undefined)
    const writeFileText = vi.fn().mockResolvedValue(undefined)

    await expect(
      saveNoteAsMarkdownFile({
        filesystemApi: { createDirectory, stat, writeFileText },
        directoryPath: '/tmp/project/sticky',
        fileName: 'note.md',
        text: '# Hello',
      }),
    ).resolves.toBe('/tmp/project/sticky/note.md')

    expect(createDirectory).toHaveBeenCalledWith({
      uri: 'file:///tmp/project/sticky',
    })
    expect(writeFileText).toHaveBeenCalledWith({
      uri: 'file:///tmp/project/sticky/note.md',
      content: '# Hello',
    })
  })

  it('writes note text through the provided filesystem API', async () => {
    const stat = vi.fn().mockResolvedValue({
      uri: 'file:///tmp/project/sticky',
      kind: 'directory',
      sizeBytes: null,
      mtimeMs: null,
    })
    const createDirectory = vi.fn().mockResolvedValue(undefined)
    const writeFileText = vi.fn().mockResolvedValue(undefined)

    await expect(
      saveNoteAsMarkdownFile({
        filesystemApi: { createDirectory, stat, writeFileText },
        directoryPath: '/tmp/project/sticky',
        fileName: 'note.md',
        text: '# Hello',
      }),
    ).resolves.toBe('/tmp/project/sticky/note.md')

    expect(createDirectory).not.toHaveBeenCalled()
    expect(writeFileText).toHaveBeenCalledWith({
      uri: 'file:///tmp/project/sticky/note.md',
      content: '# Hello',
    })
  })
})

describe('joinFileSystemPath', () => {
  it('preserves Windows-style paths', () => {
    expect(joinFileSystemPath('C:\\Users\\sure\\repo\\', 'note.md')).toBe(
      'C:\\Users\\sure\\repo\\note.md',
    )
  })
})

describe('resolveStickyNotesDirectoryPath', () => {
  it('places sticky notes under the workspace sticky directory', () => {
    expect(resolveStickyNotesDirectoryPath('/tmp/project')).toBe('/tmp/project/sticky')
  })
})
