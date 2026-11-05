import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitWorktreeInfo } from '../../../src/shared/contracts/dto'
import {
  createWorktreeInfoStore,
  worktreeInfoKey,
  type WorktreeInfoSource,
} from '../../../src/contexts/workspace/presentation/renderer/worktreeInfo/worktreeInfoStore'
import { resolveSpaceBranch } from '../../../src/contexts/workspace/presentation/renderer/worktreeInfo/spaceBranch'

const repo: WorktreeInfoSource = { repoPath: '/repo', mountIds: [] }

function worktrees(...entries: Array<[string, string | null]>): Map<string, GitWorktreeInfo> {
  return new Map(
    entries.map(([path, branch]) => [
      path,
      { path, branch, head: `${path}-head` } as GitWorktreeInfo,
    ]),
  )
}

describe('worktree info store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists a repository once for every subscriber, and again on each refresh interval', async () => {
    const list = vi.fn(async () => worktrees(['/repo', 'main']))
    const store = createWorktreeInfoStore({ list, intervalMs: 10_000 })
    const first = vi.fn()
    const second = vi.fn()
    store.subscribe(repo, first)
    store.subscribe(repo, second)
    await vi.advanceTimersByTimeAsync(0)
    expect(list).toHaveBeenCalledTimes(1)
    expect(store.read(repo).get('/repo')?.branch).toBe('main')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('stops listing when the last subscriber leaves and keeps the last snapshot', async () => {
    const list = vi.fn(async () => worktrees(['/repo', 'main']))
    const store = createWorktreeInfoStore({ list, intervalMs: 10_000 })
    const leave = store.subscribe(repo, () => undefined)
    await vi.advanceTimersByTimeAsync(0)
    leave()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(list).toHaveBeenCalledTimes(1)
    expect(store.read(repo).size).toBe(1)
  })

  it('keeps the same snapshot and stays quiet while the worktrees do not change', async () => {
    const list = vi.fn(async () => worktrees(['/repo', 'main'], ['/repo-review', 'pr/431']))
    const store = createWorktreeInfoStore({ list, intervalMs: 10_000 })
    const listener = vi.fn()
    store.subscribe(repo, listener)
    await vi.advanceTimersByTimeAsync(0)
    const snapshot = store.read(repo)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(list).toHaveBeenCalledTimes(4)
    expect(store.read(repo)).toBe(snapshot)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the last snapshot when a listing fails', async () => {
    const list = vi
      .fn<(source: WorktreeInfoSource) => Promise<Map<string, GitWorktreeInfo>>>()
      .mockResolvedValueOnce(worktrees(['/repo', 'main']))
      .mockRejectedValueOnce(new Error('git is busy'))
    const store = createWorktreeInfoStore({ list, intervalMs: 10_000 })
    store.subscribe(repo, () => undefined)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(list).toHaveBeenCalledTimes(2)
    expect(store.read(repo).get('/repo')?.branch).toBe('main')
  })

  it('does not list while the window is hidden', async () => {
    let hidden = true
    const list = vi.fn(async () => worktrees(['/repo', 'main']))
    const store = createWorktreeInfoStore({ list, intervalMs: 10_000, isHidden: () => hidden })
    store.subscribe(repo, () => undefined)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(list).not.toHaveBeenCalled()
    hidden = false
    await vi.advanceTimersByTimeAsync(10_000)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('runs a refresh asked for during a listing once that listing ends, not twice at once', async () => {
    let resolve: (value: Map<string, GitWorktreeInfo>) => void = () => undefined
    const list = vi
      .fn<(source: WorktreeInfoSource) => Promise<Map<string, GitWorktreeInfo>>>()
      .mockImplementationOnce(() => new Promise(done => (resolve = done)))
      .mockResolvedValue(worktrees(['/repo', 'main'], ['/repo-new', 'feat/new']))
    const store = createWorktreeInfoStore({ list, intervalMs: 10_000 })
    store.subscribe(repo, () => undefined)
    store.refresh(repo)
    store.refresh(repo)
    expect(list).toHaveBeenCalledTimes(1)
    resolve(worktrees(['/repo', 'main']))
    await vi.advanceTimersByTimeAsync(0)
    expect(list).toHaveBeenCalledTimes(2)
    expect(store.read(repo).get('/repo-new')?.branch).toBe('feat/new')
  })

  it('keeps sources apart by repository and by mount set, in any mount order', () => {
    expect(worktreeInfoKey({ repoPath: '/a', mountIds: ['m2', 'm1'] })).toBe(
      worktreeInfoKey({ repoPath: '/a', mountIds: ['m1', 'm2', 'm1'] }),
    )
    expect(worktreeInfoKey({ repoPath: '/a', mountIds: [] })).not.toBe(
      worktreeInfoKey({ repoPath: '/b', mountIds: [] }),
    )
    expect(worktreeInfoKey({ repoPath: '/a', mountIds: [] })).not.toBe(
      worktreeInfoKey({ repoPath: '/a', mountIds: ['m1'] }),
    )
  })
})

describe('space branch', () => {
  const list = [
    { path: '/repo', branch: 'main', head: 'aaaaaaaaaa' },
    { path: '/repo/.worktrees/review', branch: 'pr/431', head: 'bbbbbbbbbb' },
    { path: '/repo/.worktrees/bisect', branch: null, head: 'cccccccccc' },
  ] as GitWorktreeInfo[]

  it('names the branch of the worktree a Space works in', () => {
    expect(resolveSpaceBranch(list, '/repo', '/repo/.worktrees/review/src')).toEqual({
      kind: 'branch',
      value: 'pr/431',
      title: 'pr/431',
    })
  })

  it('shows a detached worktree by its short commit', () => {
    expect(resolveSpaceBranch(list, '/repo', '/repo/.worktrees/bisect')).toEqual({
      kind: 'detached',
      value: 'ccccccc',
      title: 'cccccccccc',
    })
  })

  it("says nothing for a Space in the project's own checkout, or outside any worktree", () => {
    expect(resolveSpaceBranch(list, '/repo', '/repo/packages/app')).toBeNull()
    expect(resolveSpaceBranch(list, '/repo', '/elsewhere')).toBeNull()
    expect(resolveSpaceBranch([], '/repo', '/repo/.worktrees/review')).toBeNull()
  })
})
