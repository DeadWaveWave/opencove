import type { ElectronApplication } from '@playwright/test'

/** Keep one real editor dirty through autosave; unrelated filesystem IO stays real. */
export async function rejectDocumentWrites(electronApp: ElectronApplication, uri: string) {
  await electronApp.evaluate(({ ipcMain }, targetUri) => {
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (event: unknown, request: unknown) => unknown>
      }
    )._invokeHandlers
    // Space-bound documents use mount commands; root documents use the local
    // filesystem IPC. Intercept the target URI on both real transport paths.
    for (const channel of ['control-surface:invoke', 'filesystem:write-file-text']) {
      const original = handlers.get(channel)
      if (!original) {
        throw new Error(`Missing ${channel} IPC handler`)
      }
      ipcMain.removeHandler(channel)
      ipcMain.handle(
        channel,
        (event, request: { id?: string; uri?: string; payload?: { uri?: string } }) => {
          const isTargetWrite =
            channel === 'filesystem:write-file-text'
              ? request.uri === targetUri
              : request.id === 'filesystem.writeFileTextInMount' &&
                request.payload?.uri === targetUri
          if (isTargetWrite) {
            return {
              __opencoveIpcEnvelope: true,
              ok: false,
              error: { code: 'filesystem.write_file_text_failed' },
            }
          }
          return original(event, request)
        },
      )
    }
  }, uri)
}
