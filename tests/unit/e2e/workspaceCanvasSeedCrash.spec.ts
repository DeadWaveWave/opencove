import { describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { seedWorkspaceState } from '../../e2e/workspace-canvas.helpers'

vi.mock('@playwright/test', () => ({ expect: vi.fn() }))
vi.mock('../../e2e/workspace-canvas.app', () => ({ launchApp: vi.fn() }))

describe('workspace seed crash evidence', () => {
  it('propagates the original reload crash without another persistence write', async () => {
    const crash = new Error('page.reload: Page crashed')
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValue(new Error('page.evaluate: Target crashed'))
    const page = { evaluate, reload: vi.fn().mockRejectedValue(crash) } as unknown as Page

    await expect(
      seedWorkspaceState(page, { activeWorkspaceId: 'workspace', workspaces: [] }),
    ).rejects.toBe(crash)
    expect(evaluate).toHaveBeenCalledTimes(1)
  })
})
