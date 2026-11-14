import { expect, type Page } from '@playwright/test'
import type { PersistedAppStateContract } from '../../src/shared/contracts/persistedAppState'

export async function assertFullAccessChoice(page: Page, nodeId: string): Promise<void> {
  const permission = await page.evaluate(async id => {
    const { state } = await window.opencoveApi.persistence.readAppState()
    const saved = state as PersistedAppStateContract<{ agentFullAccess: boolean }>
    const agentNode = saved.workspaces
      .flatMap(workspace => workspace.nodes)
      .find(node => node.id === id)
    return {
      setting: saved.settings.agentFullAccess,
      explicit:
        agentNode?.agent && 'agentFullAccess' in agentNode.agent
          ? agentNode.agent.agentFullAccess
          : undefined,
    }
  }, nodeId)
  expect(permission).toEqual({ setting: false, explicit: true })
}
