import { expect, type Page } from '@playwright/test'
import type { PersistWriteResult, WriteAppStateInput } from '../../src/shared/contracts/dto'

type Barrier = {
  captured: WriteAppStateInput | null
  release: () => void
  completed: Promise<PersistWriteResult>
}

declare global {
  interface Window {
    __opencovePublicationBarrier?: Barrier
  }
}

/** Install before seedWorkspaceState reloads, as in managedClaudePreparationHold. */
export async function installPublicationBarrier(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.addEventListener(
      'opencove:api-installed',
      () => {
        // Production freezes the facade. Replace it before the persistence port captures it.
        window.opencoveApi = {
          ...window.opencoveApi,
          persistence: { ...window.opencoveApi.persistence },
        }
      },
      { once: true },
    )
  })
}

/** Hold an actual renderer publication at its existing preload boundary, before Worker IO. */
export async function holdRendererPublication(page: Page, marker: string): Promise<void> {
  await page.evaluate(text => {
    const api = window.opencoveApi.persistence
    if (Object.isFrozen(api)) {
      throw new Error('Install the publication barrier before seeding/reloading the renderer')
    }
    const write = api.writeAppState.bind(api)
    let release = () => {}
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    let complete: (receipt: PersistWriteResult) => void = () => {}
    let fail: (error: unknown) => void = () => {}
    const completed = new Promise<PersistWriteResult>((resolve, reject) => {
      complete = resolve
      fail = reject
    })
    void completed.catch(() => undefined)
    const barrier: Barrier = { captured: null, release, completed }
    window.__opencovePublicationBarrier = barrier
    api.writeAppState = async payload => {
      const state = payload.state as {
        workspaces: Array<{ nodes: Array<{ id: string; task?: { text?: string } }> }>
      }
      const note = state.workspaces
        .flatMap(workspace => workspace.nodes)
        .find(node => node.id === 'note-1')
      if (barrier.captured || note?.task?.text !== text) {
        return await write(payload)
      }
      const publication = structuredClone(payload)
      barrier.captured = publication
      await held
      try {
        const receipt = await write(publication)
        complete(receipt)
        return receipt
      } catch (error) {
        fail(error)
        throw error
      } finally {
        api.writeAppState = write
      }
    }
  }, marker)
}

export async function readHeldPublication(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__opencovePublicationBarrier?.captured)))
    .toBe(true)
  return await page.evaluate(() => window.__opencovePublicationBarrier!.captured!)
}

export async function releaseRendererPublication(page: Page): Promise<PersistWriteResult> {
  return await page.evaluate(async () => {
    const barrier = window.__opencovePublicationBarrier!
    barrier.release()
    return await barrier.completed
  })
}
