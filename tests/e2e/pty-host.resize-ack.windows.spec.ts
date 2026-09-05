import { expect, test } from '@playwright/test'
import { launchApp, testWorkspacePath } from './workspace-canvas.helpers'

test.describe('PTY Host resize acknowledgement (Windows)', () => {
  test.skip(process.platform !== 'win32', 'Windows ConPTY contract')

  test('confirms ConPTY geometry and commits the actual resized grid', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const result = await window.evaluate(async cwd => {
        const spawned = await window.opencoveApi.pty.spawn({ cwd, cols: 80, rows: 24 })
        const before = await window.opencoveApi.pty.presentationSnapshot({
          sessionId: spawned.sessionId,
        })
        const resized = await window.opencoveApi.pty.resize({
          sessionId: spawned.sessionId,
          cols: 120,
          rows: 40,
          reason: 'frame_commit',
          operationId: 'windows-conpty-verified',
          baseGeometryRevision: null,
        })
        const after = await window.opencoveApi.pty.presentationSnapshot({
          sessionId: spawned.sessionId,
        })
        await window.opencoveApi.pty.kill({ sessionId: spawned.sessionId })
        return { before, resized, after }
      }, testWorkspacePath)

      expect(result.resized).toMatchObject({
        status: 'accepted',
        changed: true,
        geometry: {
          cols: 120,
          rows: 40,
        },
      })
      expect(result.after).toMatchObject({
        cols: 120,
        rows: 40,
      })
      expect(result.resized.geometry?.revision).toBeGreaterThan(result.before.geometryRevision ?? 0)
    } finally {
      await electronApp.close()
    }
  })
})
