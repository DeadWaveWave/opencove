import { bindPluginViewBridge } from '@contexts/plugins/presentation/renderer/pluginViewBridge'
import { OpenCoveAppError } from '@shared/errors/appError'
import { launchWorkspaceAgentSession } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'
import { pluginErrorMessage } from '@contexts/plugins/presentation/renderer/pluginErrorMessage'
import { publicFileSystemError } from '@shared/errors/filesystemError'

declare global {
  interface Window {
    __opencoveBridgeAcceptance?: ReturnType<typeof installDesktopAcceptanceHarness>
  }
}
/** Test-only observations use the application's imported class; no constructor is exposed. */
export function installDesktopAcceptanceHarness() {
  const harness = {
    inspect: (error: unknown) => ({
      native: error instanceof Error,
      application: error instanceof OpenCoveAppError,
      code: error instanceof OpenCoveAppError ? error.code : null,
      details: error instanceof OpenCoveAppError ? error.details : null,
      message: error instanceof Error ? error.message : '',
      serialized: JSON.stringify(error),
      pluginMessage: pluginErrorMessage(error),
      pluginDescriptor: publicFileSystemError(error),
    }),
    pluginFailure: async (): Promise<unknown> => {
      const frame = document.createElement('iframe')
      document.body.append(frame)
      const child = frame.contentWindow!
      const originalPost = child.postMessage
      let dispose = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await new Promise((resolve, reject) => {
          child.postMessage = message => resolve(message)
          dispose = bindPluginViewBridge({
            view: {
              viewId: 'bridge-view',
              resourcePath: '/bridge',
              revision: 'one',
              context: {
                pluginId: 'bridge-test',
                nodeId: 'bridge-node',
                workspaceId: null,
                directoryPath: null,
                preview: false,
              },
            },
            url: 'https://bridge.test/view',
            getFrame: () => frame,
            onTitleChange: () => {},
            onRestore: () => {},
          })
          timer = setTimeout(() => reject(new Error('Plugin response timed out')), 5000)
          window.dispatchEvent(
            new MessageEvent('message', {
              source: child,
              origin: 'https://bridge.test',
              data: {
                channel: 'opencove-plugin-v1',
                type: 'request',
                id: 'bridge-file',
                operation: 'host.request',
                payload: { operation: 'filesystem.stat', payload: {} },
              },
            }),
          )
        })
      } finally {
        clearTimeout(timer)
        dispose()
        child.postMessage = originalPost
        frame.remove()
      }
    },
    launch: async () => {
      let repairs = 0
      try {
        const result = await launchWorkspaceAgentSession({
          canvasNodeId: 'bridge-agent',
          workspaceId: 'workspace-seeded',
          mountId: 'mount-old',
          workspacePath: '/repo',
          executionDirectory: '/repo',
          provider: 'claude-code',
          mode: 'new',
          prompt: '',
          model: null,
          mergedEnv: {},
          agentSettings: {
            agentFullAccess: false,
            codexReuseRunningAppServer: false,
            defaultTerminalProfileId: null,
          },
          launchGeometry: { terminalGeometry: { cols: 80, rows: 24 } },
          retryResolveMountBinding: async () => {
            repairs += 1
            return { mountId: 'mount-new', executionDirectory: '/repo' }
          },
        })
        return { repairs, sessionId: result.sessionId, error: null }
      } catch (error) {
        return { repairs, sessionId: null, error: harness.inspect(error) }
      }
    },
  }
  window.__opencoveBridgeAcceptance = harness
  return harness
}
