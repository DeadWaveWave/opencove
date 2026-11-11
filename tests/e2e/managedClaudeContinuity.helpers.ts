import type { ControlSurfaceInvokeRequest } from '../../src/shared/contracts/controlSurface'
import type {} from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/testHarness'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'

export async function syntheticRebind(
  userDataDir: string,
  home: string,
  workspace: string,
  nodeId: string,
  priorId: string,
) {
  const nextId = randomUUID()
  // The artificial provider requires a real test transcript before it will resume B.
  const directory = path.join(
    home,
    '.claude',
    'projects',
    path.resolve(workspace).replace(/[^A-Za-z0-9]/gu, '-'),
  )
  const transcript = await readFile(path.join(directory, `${priorId}.jsonl`), 'utf8')
  await writeFile(path.join(directory, `${nextId}.jsonl`), transcript.replaceAll(priorId, nextId))
  const connection = JSON.parse(
    await readFile(path.join(userDataDir, 'control-surface.json'), 'utf8'),
  ) as { hostname: string; port: number; token: string }
  const response = await fetch(
    `http://${connection.hostname}:${connection.port}/_test/managed-claude-rebind`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, resumeSessionId: nextId }),
    },
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'committed', revision: expect.any(Number) })
  return nextId
}

export async function expectConversation(page: Page, nodeId: string, resumeSessionId: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          id =>
            window.__opencoveWorkspaceCanvasTestApi
              ?.getAgentSessions()
              .find(node => node.nodeId === id)?.resumeSessionId,
          nodeId,
        ),
      { timeout: 30_000 },
    )
    .toBe(resumeSessionId)
}

/** Hold one genuine live prepare response across a newer authoritative commit. */
export async function holdPrepare(page: Page) {
  await page.addInitScript(() => {
    let api: typeof window.opencoveApi
    let held = false
    const originalAdd = EventSource.prototype.addEventListener
    EventSource.prototype.addEventListener = function (type, callback, options) {
      if (type !== 'opencove.sync' || !callback) {
        return originalAdd.call(this, type, callback, options)
      }
      return originalAdd.call(
        this,
        type,
        event => {
          if ((window as unknown as { __dropManagedSync?: boolean }).__dropManagedSync) {
            return
          }
          if (typeof callback === 'function') {
            callback.call(this, event)
          } else {
            callback.handleEvent(event)
          }
        },
        options,
      )
    }
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      get: () => api,
      set: value => {
        api = value
        const read = api.persistence.readAppState.bind(api.persistence)
        let priorRead: Awaited<ReturnType<typeof read>> | undefined
        api.persistence.readAppState = async () => {
          const probe = window as unknown as {
            __dropManagedSync?: boolean
            __correctedManagedWrite?: boolean
          }
          if (probe.__dropManagedSync && !probe.__correctedManagedWrite && priorRead) {
            return structuredClone(priorRead)
          }
          const snapshot = await read()
          if (probe.__dropManagedSync && !probe.__correctedManagedWrite && priorRead) {
            return structuredClone(priorRead)
          }
          priorRead = snapshot
          return snapshot
        }
        const write = api.persistence.writeAppState.bind(api.persistence)
        api.persistence.writeAppState = async payload => {
          const receipt = await write(payload)
          if (receipt.ok && receipt.corrected) {
            Object.assign(window, { __correctedManagedWrite: true })
          }
          return receipt
        }
        const invoke = api.controlSurface.invoke.bind(api.controlSurface)
        api.controlSurface.invoke = async <T>(request: ControlSurfaceInvokeRequest): Promise<T> => {
          const result = await invoke<T>(request)
          if (!held && request.id === 'session.prepareOrRevive') {
            held = true
            Object.assign(window, { __heldManagedPrepare: true })
            await new Promise<void>(resolve =>
              Object.assign(window, { __releaseManagedPrepare: resolve }),
            )
          }
          return result
        }
      },
    })
  })
}

export async function releasePrepare(page: Page) {
  await page.evaluate(() => {
    const release = (window as unknown as { __releaseManagedPrepare?: () => void })
      .__releaseManagedPrepare
    release?.()
  })
}
