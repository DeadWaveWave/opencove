import { expect, type ElectronApplication, type Page } from '@playwright/test'

export async function ready(page: Page) {
  await page.waitForFunction(
    () =>
      !!window.__opencoveBridgeAcceptance &&
      typeof window.opencoveApi?.controlSurface?.invoke === 'function',
  )
}
export async function injectLaunchFailure(
  app: ElectronApplication,
  failure: unknown,
  repairSucceeds = false,
) {
  await app.evaluate(
    ({ ipcMain }, { failure: injectedFailure, repairSucceeds: shouldRepair }) => {
      const handlers = (
        ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
      )._invokeHandlers
      const original = handlers.get('control-surface:invoke')!
      const calls: string[] = []
      Object.assign(globalThis, { __bridgeLaunchCalls: calls })
      ipcMain.removeHandler('control-surface:invoke')
      ipcMain.handle('control-surface:invoke', async (event, request) => {
        if (request.id === 'system.capabilities') {
          calls.push(request.id)
          return {
            __opencoveIpcEnvelope: true,
            ok: true,
            value: { features: { managedClaudeResumeBindingDeliveryV1: true } },
          }
        }
        if (request.id === 'session.launchAgentInMount') {
          calls.push(request.id)
          if (shouldRepair && calls.filter(id => id === request.id).length === 2) {
            return {
              __opencoveIpcEnvelope: true,
              ok: true,
              value: {
                sessionId: 'repaired-session',
                executionContext: {
                  workingDirectory: '/repo',
                  endpoint: { endpointId: 'local' },
                  mountId: 'mount-new',
                },
              },
            }
          }
          return injectedFailure
        }
        return await original(event, request)
      })
    },
    { failure, repairSucceeds },
  )
}
export async function launchCalls(app: ElectronApplication) {
  return await app.evaluate(
    () => (globalThis as unknown as { __bridgeLaunchCalls: string[] }).__bridgeLaunchCalls,
  )
}
export async function expectNoSecret(page: Page) {
  await expect(page.locator('body')).not.toContainText('BRIDGE_SECRET')
}
