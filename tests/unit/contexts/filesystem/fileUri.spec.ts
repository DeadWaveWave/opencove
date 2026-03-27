import { describe, expect, it } from 'vitest'
import { toFileUri } from '../../../../src/contexts/filesystem/domain/fileUri'

describe('toFileUri', () => {
  it('encodes a POSIX absolute path', () => {
    expect(toFileUri('/tmp/Hello World/#hash')).toBe('file:///tmp/Hello%20World/%23hash')
  })

  it('converts a Windows drive path', () => {
    expect(toFileUri('C:\\Users\\a b\\repo')).toBe('file:///C:/Users/a%20b/repo')
  })

  it('converts a UNC path', () => {
    expect(toFileUri('\\\\server\\share\\folder a')).toBe('file://server/share/folder%20a')
  })
})
