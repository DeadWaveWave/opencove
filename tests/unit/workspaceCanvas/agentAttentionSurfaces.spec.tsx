import React, { useLayoutEffect, useRef } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { afterEach, expect, it } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { WorkspaceEdgeBeacons } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceEdgeBeacons'
import { CollapsedWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/CollapsedWindow'
import { createTerminalAgentWorkspace } from '../contexts/terminalAgentExit.testSupport'

function Viewport() {
  const store = useStoreApi()
  useLayoutEffect(() => {
    store.setState({ width: 1000, height: 600, transform: [0, 0, 1] })
  }, [store])
  return null
}
function Surfaces({
  blockedReason,
  title = 'Review agent',
}: {
  blockedReason: 'permission' | 'question' | 'plan' | null
  title?: string
}) {
  const node = createTerminalAgentWorkspace().nodes[0]
  node.data.title = title
  node.position = { x: 1800, y: 200 }
  node.data.agentRuntimeObservation = {
    status: 'waiting',
    source: 'claude_hook',
    hookInstallState: 'installed',
    degraded: false,
    blockedReason,
  }
  const canvasRef = useRef<HTMLDivElement | null>(null)
  return (
    <>
      <Viewport />
      <WorkspaceEdgeBeacons nodes={[node]} canvasRef={canvasRef} />
      <CollapsedWindow id={node.id} data={node.data} onExpand={() => {}} />
    </>
  )
}

afterEach(async () => {
  cleanup()
  await applyUiLanguage('en')
})

const cases = [
  ['en', 'permission', 'Needs approval'],
  ['en', 'question', 'Has a question'],
  ['en', 'plan', 'Plan ready for review'],
  ['en', null, 'Needs your answer'],
  ['zh-CN', 'permission', '需要批准'],
  ['zh-CN', 'question', '有问题想问你'],
  ['zh-CN', 'plan', '计划待审阅'],
  ['zh-CN', null, '需要你回复'],
] as const
it.each(cases)(
  'uses the same visible and accessible reason on both surfaces: %s/%s',
  async (language, blockedReason, label) => {
    await applyUiLanguage(language)
    render(
      <ReactFlowProvider>
        <Surfaces blockedReason={blockedReason} />
      </ReactFlowProvider>,
    )
    const beacon = screen.getByTestId('workspace-edge-beacon-terminal-1')
    expect(beacon.querySelector('.workspace-edge-beacon__status')).toHaveTextContent(`· ${label}`)
    expect(beacon).toHaveAccessibleName(
      language === 'en' ? `Go to Review agent, ${label}` : `前往 Review agent，${label}`,
    )
    const collapsed = screen.getByTestId('node-expand')
    expect(collapsed).toHaveAttribute('title', label)
    expect(collapsed).toHaveAttribute('aria-description', label)
    expect(screen.getByTestId('collapsed-node-terminal-1')).toHaveAttribute(
      'data-status',
      'waiting',
    )
  },
)
it('refreshes a beacon reason and keeps an untitled window distinguishable from its status', async () => {
  await applyUiLanguage('en')
  const { rerender } = render(
    <ReactFlowProvider>
      <Surfaces title="" blockedReason={null} />
    </ReactFlowProvider>,
  )
  const beacon = screen.getByTestId('workspace-edge-beacon-terminal-1')
  expect(beacon).toHaveAccessibleName('Go to Agent, Needs your answer')
  rerender(
    <ReactFlowProvider>
      <Surfaces title="" blockedReason="permission" />
    </ReactFlowProvider>,
  )
  expect(beacon).toHaveAccessibleName('Go to Agent, Needs approval')
})
