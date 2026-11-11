import { createAppError } from '../../../src/shared/errors/appError'
import { afterEach, expect, it, vi } from 'vitest'
import { launchAgentRuntime } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle.support'
import { launchWorkspaceAgentSession } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { toShellWorkspaceState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { fixture } from '../../support/convergence/fixture'
const original = window.opencoveApi
const binding = {
  nodeId: 'agent',
  activationId: 'owned',
  runtimeSessionId: 'old',
  nodeSeen: true,
  bindingRevision: 1,
  observedRevision: 1,
  tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
}
afterEach(() => {
  window.opencoveApi = original
})
it.each([
  'creation-mount',
  'creation-mount-retry',
  'creation-external-plain',
  'creation-plain',
  'creation-legacy',
  'relaunch-mount',
  'relaunch-legacy',
])('declares V1 on actual renderer route %s', async route => {
  const launch = vi.fn(async () => ({
    sessionId: 'runtime',
    provider: 'claude-code',
    startedAt: new Date().toISOString(),
    executionContext: {
      workingDirectory: '/repo',
      endpoint: { endpointId: 'local' },
      mountId: 'mount',
    },
    managedClaudeLifecycle: { binding, commitRevision: 1 },
  }))
  if (route.endsWith('retry')) {
    launch.mockRejectedValueOnce(createAppError('agent.launch_failed'))
  }
  const invoke = vi.fn(async request =>
    request.id === 'system.capabilities'
      ? { features: { managedClaudeResumeBindingDeliveryV1: true } }
      : launch(request),
  )
  window.opencoveApi = {
    controlSurface: route.endsWith('legacy') ? undefined : { invoke },
    agent: { launch },
  } as unknown as typeof window.opencoveApi
  if (route.startsWith('creation')) {
    await launchWorkspaceAgentSession({
      canvasNodeId:
        route.endsWith('legacy') || route === 'creation-external-plain' ? undefined : 'agent',
      mountId: route.includes('mount') ? 'mount' : null,
      workspacePath: '/repo',
      executionDirectory: route === 'creation-external-plain' ? '/external' : '/repo',
      retryResolveMountBinding: async () => ({
        mountId: 'mount-next',
        executionDirectory: '/repo',
      }),
      prompt: '',
      provider: 'claude-code',
      mode: 'new',
      model: null,
      mergedEnv: {},
      agentSettings: DEFAULT_AGENT_SETTINGS,
      launchGeometry: { terminalGeometry: { cols: 80, rows: 24 } },
    })
  } else {
    const workspace = fixture(true).workspaces[0]
    await launchAgentRuntime({
      node: toShellWorkspaceState(workspace).nodes[0] as never,
      intent: { kind: 'resumeCurrent' },
      mountId: route.includes('mount') ? 'mount' : null,
      mergedEnv: {},
      mode: 'resume',
      executionDirectory: '/repo',
      resumeSessionId: 'A',
      agentFullAccess: false,
      codexReuseRunningAppServer: false,
      defaultTerminalProfileId: null,
      executablePathOverride: null,
      terminalFontSize: 13,
      terminalDisplayMetrics: { fontSize: 13 },
    })
  }
  expect(launch).toHaveBeenCalledTimes(route.endsWith('retry') ? 2 : 1)
  for (const call of launch.mock.calls) {
    expect(call[0]).toMatchObject({
      clientFeatures: { managedClaudeResumeBindingV1: true },
    })
  }
})
