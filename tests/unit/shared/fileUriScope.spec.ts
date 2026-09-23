import { describe, expect, it } from 'vitest'
import {
  isFileUriWithinRoot,
  normalizeFileUri,
  resolveFileUriBreadcrumbs,
  resolveFileUriName,
  resolveFileUriParent,
} from '@shared/utils/fileUriScope'

describe('file URI navigation scope', () => {
  it('normalizes directory spelling without losing encoded names or filesystem roots', () => {
    expect(normalizeFileUri(' file:///repo/design%20notes/ ')).toBe('file:///repo/design%20notes')
    expect(normalizeFileUri('file:///')).toBe('file:///')
    expect(normalizeFileUri('file:///C:/')).toBe('file:///C:/')
    expect(normalizeFileUri('file://SERVER/share/docs/')).toBe('file://server/share/docs')
    expect(normalizeFileUri('https://example.test/repo')).toBeNull()
    expect(normalizeFileUri('file:///repo/%GG')).toBeNull()
    expect(normalizeFileUri('file:///repo/a%2fb')).toBeNull()
  })

  it('keeps navigation on the same host and inside the path segment boundary', () => {
    expect(isFileUriWithinRoot('file:///', 'file:///repo/docs')).toBe(true)
    expect(isFileUriWithinRoot('file:///repo', 'file:///repo/docs')).toBe(true)
    expect(isFileUriWithinRoot('file:///repo', 'file:///repository')).toBe(false)
    expect(isFileUriWithinRoot('file:///repo', 'file:///repo/%2e%2e/private')).toBe(false)
    expect(isFileUriWithinRoot('file:///repo', 'file:///repo/%2e%2e%2fprivate')).toBe(false)
    expect(isFileUriWithinRoot('file://server/share', 'file://other/share/docs')).toBe(false)
    expect(isFileUriWithinRoot('file:///C:/repo', 'file:///c:/repo/docs')).toBe(true)
  })

  it('returns clickable ancestors including the root and stops upward navigation there', () => {
    expect(resolveFileUriBreadcrumbs('file:///repo', 'file:///repo/docs/design')).toEqual([
      { uri: 'file:///repo', name: 'repo' },
      { uri: 'file:///repo/docs', name: 'docs' },
      { uri: 'file:///repo/docs/design', name: 'design' },
    ])
    expect(resolveFileUriParent('file:///repo/docs/design/', 'file:///repo')).toBe(
      'file:///repo/docs',
    )
    expect(resolveFileUriParent('file:///repo', 'file:///repo')).toBeNull()
    expect(resolveFileUriBreadcrumbs('file:///repo', 'file:///private')).toEqual([])
    expect(resolveFileUriName('file:///repo/design%20notes')).toBe('design notes')
  })
})
