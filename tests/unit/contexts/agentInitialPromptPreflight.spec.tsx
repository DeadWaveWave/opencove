import { act } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { rendererLifecycleFixture } from '../../support/managedClaudeRendererLifecycle'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { runTaskAgentAction } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.run'
import type { TaskActionContext } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.shared'

it.each([false, true])(
  'refused relaunch keeps its old runtime alive (mounted=%s)',
  async mounted => {
    const f = rendererLifecycleFixture(mounted)
    await act(() => f.result.current.launchAgentInNode('agent', 'new', { prompt: 'update' }))
    expect(window.opencoveApi.pty.kill).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
    expect(f.nodesRef.current[0].data.sessionId).toBe('old')
    expect(f.nodesRef.current[0].data.lastError).toContain('Rephrase')
  },
)
it('refused task reuse preserves todo, requirement and old session', async () => {
  const f = rendererLifecycleFixture(false)
  f.nodesRef.current.push({
    ...f.nodesRef.current[0],
    id: 'task',
    data: {
      ...f.nodesRef.current[0].data,
      kind: 'task',
      agent: null,
      task: { requirement: 'update', status: 'todo', linkedAgentNodeId: 'agent' } as never,
    },
  })
  const launchAgentInNode = vi.fn()
  await act(() =>
    runTaskAgentAction('task', {
      workspaceId: 'workspace',
      workspacePath: '/repo',
      nodesRef: f.nodesRef,
      spacesRef: f.spacesRef,
      agentSettings: DEFAULT_AGENT_SETTINGS,
      setNodes: updater => {
        f.nodesRef.current = updater(f.nodesRef.current)
      },
      launchAgentInNode,
      onSpacesChange: vi.fn(),
      t: (key: string) => key,
    } as unknown as TaskActionContext),
  )
  expect(launchAgentInNode).not.toHaveBeenCalled()
  expect(window.opencoveApi.pty.kill).not.toHaveBeenCalled()
  expect(f.nodesRef.current.find(node => node.id === 'task')?.data.task).toMatchObject({
    requirement: 'update',
    status: 'todo',
  })
  expect(f.nodesRef.current[0].data.sessionId).toBe('old')
})

it('refused new task keeps editable requirements before any launch or space change', async () => {
  const f = rendererLifecycleFixture(false)
  f.nodesRef.current[0] = {
    ...f.nodesRef.current[0],
    id: 'task',
    data: {
      ...f.nodesRef.current[0].data,
      kind: 'task',
      agent: null,
      task: { requirement: 'config', status: 'todo', linkedAgentNodeId: null } as never,
    },
  }
  const onSpacesChange = vi.fn()
  await act(() =>
    runTaskAgentAction('task', {
      workspaceId: 'workspace',
      workspacePath: '/repo',
      nodesRef: f.nodesRef,
      spacesRef: f.spacesRef,
      agentSettings: { ...DEFAULT_AGENT_SETTINGS, defaultProvider: 'pi' },
      setNodes: updater => {
        f.nodesRef.current = updater(f.nodesRef.current)
      },
      onSpacesChange,
    } as unknown as TaskActionContext),
  )
  expect(f.launch).not.toHaveBeenCalled()
  expect(onSpacesChange).not.toHaveBeenCalled()
  expect(f.nodesRef.current[0].data.task).toMatchObject({ requirement: 'config', status: 'todo' })
})
