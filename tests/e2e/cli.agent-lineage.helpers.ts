import { expect, type Page } from '@playwright/test'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
export { writeLineageAgentStub, grantedAgentCli } from '../support/cliLineageAgent'

export async function createLineageAgent(
  page: Page,
  targetProjectId: string,
): Promise<CreateNodeResult> {
  return page.evaluate(
    async projectId =>
      window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
        kind: 'command',
        id: 'node.create',
        payload: {
          kind: 'agent',
          projectId,
          title: 'Coordinator',
          data: { provider: 'claude-code', prompt: '' },
        },
      }),
    targetProjectId,
  )
}
export async function establishLineageAgentReady(
  page: Page,
  node: { id: string; sessionId?: string | null },
) {
  await page.evaluate(
    async nodeId =>
      window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'canvas.focus',
        payload: { target: { kind: 'node', nodeId } },
      }),
    node.id,
  )
  await expect(page.locator(`[data-id="${node.id}"] .terminal-node`)).toContainText(
    'STRICT_READY',
    { timeout: 20_000 },
  )
  await page.evaluate(
    async binding =>
      window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'session.writeNode',
        payload: { nodeId: binding.id, sessionId: binding.sessionId, data: 'manual baseline\r' },
      }),
    node,
  )
  await expect
    .poll(
      () =>
        page.evaluate(
          async id =>
            (
              await window.opencoveApi.controlSurface.invoke<{ state: string }>({
                kind: 'query',
                id: 'agent.get',
                payload: { nodeId: id },
              })
            ).state,
          node.id,
        ),
      { timeout: 20_000 },
    )
    .toBe('idle')
}
