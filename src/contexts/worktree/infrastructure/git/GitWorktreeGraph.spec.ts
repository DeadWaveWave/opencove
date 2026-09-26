import { describe, expect, it } from 'vitest'
import { parseGitGraphDecorations, parseGitGraphLog } from './GitWorktreeGraph'

describe('parseGitGraphDecorations', () => {
  it('normalizes HEAD and picks the local branch before remote and tag refs', () => {
    expect(parseGitGraphDecorations('HEAD -> main, origin/main, tag: v1.2.0')).toEqual({
      branch: 'main',
      refs: ['main', 'origin/main', 'tag: v1.2.0'],
    })
  })

  it('returns no branch when decorations only contain remote and tag refs', () => {
    expect(parseGitGraphDecorations('origin/main, tag: v1.0.0')).toEqual({
      branch: null,
      refs: ['origin/main', 'tag: v1.0.0'],
    })
  })

  it('ignores empty decoration entries', () => {
    expect(parseGitGraphDecorations(' , HEAD -> feature/demo, ')).toEqual({
      branch: 'feature/demo',
      refs: ['feature/demo'],
    })
  })
})

describe('parseGitGraphLog', () => {
  it('parses commits, parents, refs, metadata, and subjects from the git record stream', () => {
    const stdout =
      '0123456789abcdef\u001fparent-one parent-two\u001fAda Lovelace\u001f2026-09-27T10:20:30+00:00\u001fHEAD -> main, origin/main\u001fMerge the feature\u001e' +
      'fedcba9876543210\u001f\u001fGrace Hopper\u001f2026-09-26T09:00:00+00:00\u001ftag: v1.0.0\u001fInitial commit\u001e'

    expect(parseGitGraphLog(stdout)).toEqual([
      {
        commit: '0123456789abcdef',
        shortCommit: '0123456',
        parents: ['parent-one', 'parent-two'],
        branch: 'main',
        refs: ['main', 'origin/main'],
        author: 'Ada Lovelace',
        authoredAt: '2026-09-27T10:20:30+00:00',
        subject: 'Merge the feature',
      },
      {
        commit: 'fedcba9876543210',
        shortCommit: 'fedcba9',
        parents: [],
        branch: null,
        refs: ['tag: v1.0.0'],
        author: 'Grace Hopper',
        authoredAt: '2026-09-26T09:00:00+00:00',
        subject: 'Initial commit',
      },
    ])
  })

  it('keeps field separators in a subject and skips empty or malformed records without a commit', () => {
    const stdout =
      '\u001e\u001f\u001f\u001f\u001f\u001f\u001e' +
      'abc123\u001f\u001f\u001f\u001f\u001fsubject part one\u001fsubject part two\u001e'

    expect(parseGitGraphLog(stdout)).toEqual([
      {
        commit: 'abc123',
        shortCommit: 'abc123',
        parents: [],
        branch: null,
        refs: [],
        author: null,
        authoredAt: null,
        subject: 'subject part one\u001fsubject part two',
      },
    ])
  })

  it('normalizes blank metadata to null and trims surrounding record whitespace', () => {
    const stdout = '  abc123\u001f\u001f  \u001f  \u001f  \u001f  Subject  \u001e'

    expect(parseGitGraphLog(stdout)[0]).toMatchObject({
      commit: 'abc123',
      author: null,
      authoredAt: null,
      subject: 'Subject',
    })
  })
})
