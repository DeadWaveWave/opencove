import { describe, expect, it } from 'vitest'
import { toFileUri } from '../../../../src/contexts/filesystem/domain/fileUri'

describe('toFileUri', () => {
  it('encodes a POSIX absolute path', () => {
    expect(toFileUri('/tmp/Hello World/#hash')).toBe('file:///tmp/Hello%20World/%23hash')
  })

  it('encodes literal percent characters', () => {
    expect(toFileUri('/tmp/100% done/%20')).toBe('file:///tmp/100%25%20done/%2520')
  })

  it('converts a Windows drive path', () => {
    expect(toFileUri('C:\\Users\\a b\\repo')).toBe('file:///C:/Users/a%20b/repo')
  })

  it('preserves lower-case Windows drive letters', () => {
    expect(toFileUri('c:\\Users\\a b\\repo')).toBe('file:///c:/Users/a%20b/repo')
  })

  it('converts a UNC path', () => {
    expect(toFileUri('\\\\server\\share\\folder a')).toBe('file://server/share/folder%20a')
  })

  it('converts an already-normalized UNC path', () => {
    expect(toFileUri('//server/share/folder a')).toBe('file://server/share/folder%20a')
  })

  it('converts a UNC root share path', () => {
    expect(toFileUri('\\\\server\\share')).toBe('file://server/share')
  })
})
