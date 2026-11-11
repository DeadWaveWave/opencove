import type { Page } from '@playwright/test'
import type { GetNodeResult, LaunchAgentSessionResult } from '../../src/shared/contracts/dto'
import type { ManagedClaudeLaunchIntent } from '../../src/shared/contracts/managedClaudeLaunch'
import { terminalCommand, jsonOutput } from './cli.terminal.helpers'
import { shellWord } from '../../src/app/cli/core/shellWord'

export const projectId = 'managed-launch-project'
export const spaceId = 'managed-launch-main'
export const roleId = 'managed-launch-role'
export const roleDefinitionId = 'managed-launch-role-definition'
export function cliCommand(...args: string[]) {
  return ['opencove', ...args.map(value => shellWord(value))].join(' ')
}
export async function getBinding(page: Page, requestedNodeId: string) {
  const result = await page.evaluate(
    async nodeId =>
      window.opencoveApi.controlSurface.invoke<GetNodeResult>({
        kind: 'query',
        id: 'node.get',
        payload: { nodeId },
      }),
    requestedNodeId,
  )
  if (!result.managedClaudeBinding) {
    throw new Error(`Expected managed binding for ${requestedNodeId}`)
  }
  return result.managedClaudeBinding
}
export async function launch(
  page: Page,
  requestedNodeId: string,
  directory: string,
  launchIntent: ManagedClaudeLaunchIntent,
  staleId?: string,
) {
  return page.evaluate(
    async ({ nodeId, cwd, intent, cachedId, targetSpaceId }) => {
      const mode = intent.kind === 'launchNew' ? 'new' : 'resume'
      return window.opencoveApi.controlSurface.invoke<LaunchAgentSessionResult>({
        kind: 'command',
        id: 'session.launchAgent',
        clientFeatures: { managedClaudeResumeBindingV1: true },
        payload: {
          canvasNodeId: nodeId,
          spaceId: targetSpaceId,
          cwd,
          provider: 'claude-code',
          prompt: 'Managed lifecycle fixture',
          mode,
          intent,
          resumeSessionId:
            intent.kind === 'resumeConversation'
              ? intent.resumeSessionId
              : mode === 'resume'
                ? cachedId
                : null,
        },
      })
    },
    {
      nodeId: requestedNodeId,
      cwd: directory,
      intent: launchIntent,
      cachedId: staleId,
      targetSpaceId: spaceId,
    },
  )
}
export async function createCliAgent(page: Page, terminal: { nodeId: string; sessionId: string }) {
  const result = jsonOutput(
    await terminalCommand(
      page,
      terminal,
      cliCommand(
        'node',
        'create',
        'agent',
        '--provider',
        'claude-code',
        '--prompt',
        'Managed lifecycle fixture',
      ),
      'CREATE_MANAGED',
    ),
  )
  return result.node as { id: string; sessionId: string }
}
