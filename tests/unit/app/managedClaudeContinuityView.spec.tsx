import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { TerminalNodeHeader } from '@contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeHeader'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { updateWorkspacesWithAgentExit } from '@app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync'
import { toShellWorkspaceStateForSync } from '@app/renderer/shell/hooks/workerSync/mergeWorkspaceStateForSync'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { fixture } from '../../support/convergence/fixture'
import { expectConversation } from '../../e2e/managedClaudeContinuity.helpers'

// Run the real E2E assertion against real header DOM, adapting only the browser driver/assertions.
vi.mock('@playwright/test', async () => {
  const { expect: assert } = await import('vitest')
  const { waitFor: observe } = await import('@testing-library/react')
  const check = (locator: { element(): Element | null }) => ({
    toBeVisible: () => observe(() => assert(locator.element()).toBeVisible(), { timeout: 150 }),
    toBeDisabled: () => observe(() => assert(locator.element()).toBeDisabled(), { timeout: 150 }),
  })
  return {
    expect: Object.assign(check, {
      poll: (read: () => unknown) => ({
        toBe: (value: unknown) =>
          observe(async () => assert(await read()).toBe(value), { timeout: 150 }),
      }),
    }),
  }
})

class DomLocator {
  constructor(readonly element: () => Element | null) {}
  getByTestId(id: string) {
    return this.locator(`[data-testid="${id}"]`)
  }
  locator(selector: string): DomLocator {
    return new DomLocator(() => this.element()?.querySelector(selector) ?? null)
  }
  async click() {
    const target = await waitFor(() => {
      const element = this.element()
      expect(element).not.toBeNull()
      return element!
    })
    await act(async () => {
      fireEvent.click(target)
    })
  }
}
const page = {
  locator: (selector: string) => new DomLocator(() => document.querySelector(selector)),
  getByTestId: (id: string) =>
    new DomLocator(() => document.querySelector(`[data-testid="${id}"]`)),
  evaluate: async (read: (value: string) => unknown, value: string) => read(value),
  keyboard: {
    press: async (key: string) => {
      await act(async () => {
        fireEvent.keyDown(document, { key })
      })
    },
  },
} as unknown as Page
const originalApi = window.opencoveApi
const originalProbe = window.__opencoveWorkspaceCanvasTestApi
afterEach(() => {
  cleanup()
  window.opencoveApi = originalApi
  window.__opencoveWorkspaceCanvasTestApi = originalProbe
})
function Header({ data }: { data: TerminalNodeData }) {
  return (
    <div data-id="agent">
      <TerminalNodeHeader
        title="Managed lifecycle fixture"
        kind="agent"
        status={data.status}
        agentExecutionDirectory={data.agent!.executionDirectory}
        agentResumeSessionId={data.agent!.resumeSessionId}
        agentResumeSessionIdVerified={data.agent!.resumeSessionIdVerified === true}
        onClose={() => {}}
        onReloadSession={async () => {}}
        onListSessions={async () =>
          ['A', 'B'].map(sessionId => ({
            sessionId,
            provider: 'claude-code' as const,
            cwd: '/tmp/convergence',
            title: `Conversation ${sessionId}`,
            preview: null,
            startedAt: null,
            updatedAt: null,
            source: 'claude-jsonl' as const,
          }))
        }
        onSwitchSession={async () => {}}
      />
    </div>
  )
}
it.each(['browser', 'electron'] as const)(
  'reads the %s current conversation through exit and canonical projection without a private probe',
  async runtime => {
    window.opencoveApi = {
      meta: { runtime, isTest: runtime === 'electron' },
      persistence: {},
    } as unknown as typeof window.opencoveApi
    Reflect.deleteProperty(window, '__opencoveWorkspaceCanvasTestApi')
    const before = fixture(true).workspaces[0]
    let workspace = toShellWorkspaceState(before)
    const view = render(<Header data={workspace.nodes[0].data} />)
    await expectConversation(page, 'agent', 'A')
    expect(screen.queryByTestId('terminal-node-session-menu')).toBeNull()
    const original = workspace.nodes[0].data
    workspace = updateWorkspacesWithAgentExit({
      workspaces: [workspace],
      sessionId: 'runtime',
      exitCode: 0,
      now: '2026-11-12T00:00:00Z',
    }).nextWorkspaces[0]
    expect(workspace.nodes[0].data.agent).toBe(original.agent)
    expect(workspace.nodes[0].data.managedClaudeResumeBindingOwnership).toBe(
      original.managedClaudeResumeBindingOwnership,
    )
    view.rerender(<Header data={workspace.nodes[0].data} />)
    expect(screen.getByText('Exited')).toBeVisible()
    await expectConversation(page, 'agent', 'A')
    const canonical = structuredClone(before)
    canonical.nodes[0].agent!.resumeSessionId = 'B'
    canonical.nodes[0].sessionId = ''
    canonical.nodes[0].status = 'exited'
    canonical.nodes[0].managedClaudeResumeBindingOwnership!.runtimeSessionId = null
    workspace = toShellWorkspaceStateForSync(canonical, workspace, before)
    await act(async () => {
      view.rerender(<Header data={workspace.nodes[0].data} />)
    })
    await expectConversation(page, 'agent', 'B')
    expect(screen.queryByTestId('terminal-node-session-menu')).toBeNull()
  },
)

it('rejects a catalog entry that is not the local current conversation and closes its menu', async () => {
  Reflect.deleteProperty(window, '__opencoveWorkspaceCanvasTestApi')
  const workspace = toShellWorkspaceState(fixture(true).workspaces[0])
  render(<Header data={workspace.nodes[0].data} />)
  await expect(expectConversation(page, 'agent', 'B')).rejects.toThrow()
  expect(screen.queryByTestId('terminal-node-session-menu')).toBeNull()
})

it('shows a detached exited owned conversation without a PTY session identifier', async () => {
  Reflect.deleteProperty(window, '__opencoveWorkspaceCanvasTestApi')
  const canonical = fixture(true).workspaces[0]
  canonical.nodes[0].sessionId = ''
  canonical.nodes[0].status = 'exited'
  canonical.nodes[0].managedClaudeResumeBindingOwnership!.runtimeSessionId = null
  const workspace = toShellWorkspaceState(canonical)
  expect(workspace.nodes[0].data.sessionId).toBe('')
  render(<Header data={workspace.nodes[0].data} />)
  await expectConversation(page, 'agent', 'A')
  expect(screen.queryByTestId('terminal-node-session-menu')).toBeNull()
})
