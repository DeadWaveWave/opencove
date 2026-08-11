import { expect, test } from '@playwright/test'
import { launchApp, testWorkspacePath } from './workspace-canvas.helpers'

test.describe('PTY Host resize acknowledgement (Windows)', () => {
  test.skip(process.platform !== 'win32', 'Windows ConPTY contract')

  test('keeps deferred ConPTY geometry unverified without committing the request', async () => {
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
          operationId: 'windows-conpty-unverified',
          baseGeometryRevision: null,
        })
        const after = await window.opencoveApi.pty.presentationSnapshot({
          sessionId: spawned.sessionId,
        })
        await window.opencoveApi.pty.kill({ sessionId: spawned.sessionId })
        return { before, resized, after }
      }, testWorkspacePath)

      expect(result.resized).toMatchObject({
        status: 'accepted_unverified',
        changed: false,
        geometry: {
          cols: result.before.cols,
          rows: result.before.rows,
          revision: result.before.geometryRevision,
        },
      })
      expect(result.after).toMatchObject({
        cols: result.before.cols,
        rows: result.before.rows,
        geometryRevision: result.before.geometryRevision,
      })
      expect(result.after).not.toMatchObject({ cols: 120, rows: 40 })
    } finally {
      await electronApp.close()
    }
  })
})
