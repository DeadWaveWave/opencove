import { app, BrowserWindow, webContents, type WebContents } from 'electron'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import type { ApplicationShortcutEvent } from '../../shared/contracts/applicationShortcut'
import {
  createApplicationShortcutPolicy,
  QUIT_CONFIRMATION_INTERVAL_MS,
} from './applicationShortcutPolicy'

export function registerApplicationShortcuts(window: BrowserWindow): () => void {
  const hostContents = window.webContents
  const policy = createApplicationShortcutPolicy(process.platform)
  const disposables = new Map<WebContents, () => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const send = (event: ApplicationShortcutEvent): void => {
    if (!window.isDestroyed() && !hostContents.isDestroyed()) {
      hostContents.send(IPC_CHANNELS.appShortcut, event)
    }
  }
  const reset = (): void => {
    const hadPendingQuit = policy.hasPendingQuit()
    clearTimeout(timer)
    timer = undefined
    policy.reset()
    if (hadPendingQuit) {
      send('quit-cancelled')
    }
  }
  const attach = (contents: WebContents): void => {
    const onInput = (event: Electron.Event, input: Electron.Input): void => {
      // Native website views have a separate input stream but share the host window's policy.
      if (window.isDestroyed() || BrowserWindow.fromWebContents(contents) !== window) {
        return
      }
      const result = policy.handle(input)
      if (result.consumed) {
        event.preventDefault()
      }
      if (result.cancelled) {
        clearTimeout(timer)
        timer = undefined
        send('quit-cancelled')
      }
      if (result.action === 'quit') {
        clearTimeout(timer)
        app.quit()
      } else if (result.action === 'quit-armed') {
        clearTimeout(timer)
        timer = setTimeout(reset, QUIT_CONFIRMATION_INTERVAL_MS)
        send('quit-armed')
      } else if (result.action === 'close-selected-node') {
        reset()
        send('close-selected-node')
      }
    }
    const onNavigate = (): void => {
      if (!window.isDestroyed() && BrowserWindow.fromWebContents(contents) === window) {
        reset()
      }
    }
    const dispose = (): void => {
      contents.removeListener('before-input-event', onInput)
      contents.removeListener('did-start-navigation', onNavigate)
      contents.removeListener('destroyed', dispose)
      disposables.delete(contents)
    }
    contents.on('before-input-event', onInput)
    contents.on('did-start-navigation', onNavigate)
    contents.once('destroyed', dispose)
    disposables.set(contents, dispose)
  }
  const onCreated = (_event: Electron.Event, contents: WebContents): void => attach(contents)
  webContents.getAllWebContents().forEach(attach)
  app.on('web-contents-created', onCreated)
  const onBlur = (): void => {
    reset()
  }
  const onRenderProcessGone = (): void => {
    reset()
  }
  window.on('blur', onBlur)
  hostContents.on('render-process-gone', onRenderProcessGone)
  return () => {
    clearTimeout(timer)
    policy.reset()
    app.removeListener('web-contents-created', onCreated)
    window.removeListener('blur', onBlur)
    hostContents.removeListener('render-process-gone', onRenderProcessGone)
    for (const dispose of disposables.values()) {
      dispose()
    }
  }
}
