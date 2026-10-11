import { describe, expect, it, vi } from 'vitest'
import { resolveTerminalLinkTarget } from '../../src/contexts/terminal/application/links/resolveTerminalLinkTarget'

const observed = {
  cwd: '/repo/worktree',
  cwdSource: 'observed' as const,
  platform: 'posix' as const,
  mountId: 'source-mount',
  endpointId: 'source-worker',
}

describe('terminal link target resolution', () => {
  it('verifies exactly the source route and carries the full editor selection', async () => {
    const stat = vi.fn().mockResolvedValue({ kind: 'file' })
    const result = await resolveTerminalLinkTarget(
      { kind: 'file', rawTarget: './src/a.ts', line: 3, column: 2, lineEnd: 5, columnEnd: 8 },
      observed,
      stat,
    )
    expect(stat).toHaveBeenCalledExactlyOnceWith({
      uri: 'file:///repo/worktree/src/a.ts',
      mountId: 'source-mount',
      endpointId: 'source-worker',
    })
    expect(result).toEqual({
      status: 'resolved',
      target: {
        kind: 'file',
        uri: 'file:///repo/worktree/src/a.ts',
        path: '/repo/worktree/src/a.ts',
        mountId: 'source-mount',
        endpointId: 'source-worker',
        line: 3,
        column: 2,
        lineEnd: 5,
        columnEnd: 8,
      },
    })
  })

  it('requires explicit confirmation for relative links resolved from launch cwd', async () => {
    const stat = vi.fn().mockResolvedValue({ kind: 'file' })
    expect(
      await resolveTerminalLinkTarget(
        { kind: 'file', rawTarget: 'src/a.ts' },
        { ...observed, cwdSource: 'launch' },
        stat,
      ),
    ).toMatchObject({ status: 'confirmation_required', reason: 'launch_cwd' })
    expect(
      await resolveTerminalLinkTarget(
        { kind: 'file', rawTarget: '/repo/a.ts' },
        { ...observed, cwdSource: 'launch' },
        stat,
      ),
    ).toMatchObject({ status: 'resolved' })
  })

  it.each([
    ['src/a.ts', { ...observed, cwdSource: 'unknown' as const }, 'unknown_cwd'],
    ['~/a.ts', observed, 'unknown_home'],
    ['~other/a.ts', observed, 'unknown_home'],
    ['javascript:alert(1)', observed, 'unsupported_scheme'],
    ['file://other-host/repo/a.ts', observed, 'unsupported_authority'],
    ['C:\\repo\\a.ts', observed, 'platform_mismatch'],
    ['file:///repo/%2fa.ts', observed, 'invalid_target'],
    ['file:///repo/%broken', observed, 'invalid_target'],
    ['file:///repo/a.ts?query=1', observed, 'invalid_target'],
    ['file:relative.ts', observed, 'invalid_target'],
    ['/repo/\ud800.ts', observed, 'invalid_target'],
    ['~/a.ts', { ...observed, home: 'relative-home' }, 'unknown_home'],
    ['a\u0000.ts', observed, 'invalid_target'],
  ])('rejects %s without filesystem IO', async (rawTarget, source, reason) => {
    const stat = vi.fn()
    expect(await resolveTerminalLinkTarget({ kind: 'file', rawTarget }, source, stat)).toEqual({
      status: 'unresolved',
      reason,
    })
    expect(stat).not.toHaveBeenCalled()
  })

  it.each(['not_found', 'forbidden', 'unavailable'] as const)(
    'keeps %s explicit and never retries another mount or local root',
    async reason => {
      const stat = vi.fn().mockResolvedValue({ reason })
      expect(
        await resolveTerminalLinkTarget({ kind: 'file', rawTarget: 'src/a.ts' }, observed, stat),
      ).toEqual({ status: 'unresolved', reason })
      expect(stat).toHaveBeenCalledTimes(1)
    },
  )

  it('maps missing files and unexpected transport failures without leaking exceptions', async () => {
    const input = { kind: 'file' as const, rawTarget: 'a.ts' }
    expect(await resolveTerminalLinkTarget(input, observed, async () => null)).toEqual({
      status: 'unresolved',
      reason: 'not_found',
    })
    expect(
      await resolveTerminalLinkTarget(input, observed, async () => {
        throw new Error('offline')
      }),
    ).toEqual({
      status: 'unresolved',
      reason: 'unavailable',
    })
  })

  it('retains raw URL encoding and never stats web links', async () => {
    const stat = vi.fn()
    const rawTarget = 'https://example.com/a%2Bb?q=x%25y#part'
    expect(await resolveTerminalLinkTarget({ kind: 'url', rawTarget }, observed, stat)).toEqual({
      status: 'resolved',
      target: { kind: 'url', uri: rawTarget },
    })
    expect(stat).not.toHaveBeenCalled()
  })

  it.each(['javascript:alert(1)', 'mailto:test@example.com', 'data:text/plain,test'])(
    'blocks %s as a URL',
    async rawTarget => {
      expect(
        await resolveTerminalLinkTarget({ kind: 'url', rawTarget }, observed, vi.fn()),
      ).toEqual({
        status: 'unresolved',
        reason: 'unsupported_scheme',
      })
    },
  )

  it.each([
    ['/repo/100% ready#?.ts', 'file:///repo/100%25%20ready%23%3F.ts'],
    ['/repo/a%20b.ts', 'file:///repo/a%2520b.ts'],
    ['/repo/a\\b.ts', 'file:///repo/a%5Cb.ts'],
    ['file:///repo/a%2520b.ts', 'file:///repo/a%2520b.ts'],
    ['file:///repo/a%20b.ts', 'file:///repo/a%20b.ts'],
    ['~/src/a.ts', 'file:///home/remote/src/a.ts'],
  ])('encodes filesystem name %s exactly once', async (rawTarget, uri) => {
    expect(
      await resolveTerminalLinkTarget(
        { kind: 'file', rawTarget },
        { ...observed, home: '/home/remote' },
        async () => ({ kind: 'file' }),
      ),
    ).toMatchObject({ status: 'resolved', target: { uri } })
  })

  it.each([
    ['C:\\repo\\file name.ts', 'file:///C:/repo/file%20name.ts'],
    ['file:///C:/repo/a%2520.ts', 'file:///C:/repo/a%2520.ts'],
    ['..\\src\\a.ts', 'file:///C:/repo/src/a.ts'],
    ['\\\\server\\share\\a.ts', 'file://server/share/a.ts'],
    ['file://server/share/a.ts', 'file://server/share/a.ts'],
  ])('uses the source Windows platform for %s', async (rawTarget, uri) => {
    expect(
      await resolveTerminalLinkTarget(
        { kind: 'file', rawTarget },
        { ...observed, platform: 'windows', cwd: 'C:\\repo\\worktree' },
        async () => ({ kind: 'file' }),
      ),
    ).toMatchObject({ status: 'resolved', target: { uri } })
  })

  it('returns directories distinctly and rejects unknown entry types', async () => {
    const input = { kind: 'file' as const, rawTarget: '/repo/src' }
    expect(
      await resolveTerminalLinkTarget(input, observed, async () => ({ kind: 'directory' })),
    ).toMatchObject({
      status: 'resolved',
      target: { kind: 'directory' },
    })
    expect(
      await resolveTerminalLinkTarget(input, observed, async () => ({ kind: 'unknown' })),
    ).toEqual({
      status: 'unresolved',
      reason: 'unsupported_entry',
    })
  })
})
