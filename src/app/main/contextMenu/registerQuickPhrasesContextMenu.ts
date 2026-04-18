import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { resolve } from 'node:path'
import {
  normalizeAgentSettings,
  type QuickPhrase,
} from '../../../contexts/settings/domain/agentSettings'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { createPersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../platform/persistence/sqlite/normalize'
import type { ControlSurfaceRemoteEndpointResolver } from '../controlSurface/remote/controlSurfaceHttpClient'
import { createRemotePersistenceStore } from '../controlSurface/remote/remotePersistenceStore'

const QUICK_PHRASES_CACHE_TTL_MS = 1_500

type CachedQuickPhraseSettings = {
  language: string
  phrases: QuickPhrase[]
  cachedAtMs: number
}

async function resolveQuickPhraseSettings(
  store: PersistenceStore,
): Promise<CachedQuickPhraseSettings | null> {
  const raw = await store.readAppState()
  const normalized = normalizePersistedAppState(raw)
  const settings = normalizeAgentSettings(normalized?.settings)

  return {
    language: settings.language,
    phrases: settings.quickPhrases,
    cachedAtMs: Date.now(),
  }
}

function resolveQuickPhrasesSubmenuLabel(language: string): string {
  return language === 'zh-CN' ? '快捷短语' : 'Quick Phrases'
}

export function registerQuickPhrasesContextMenu({
  window,
  userDataPath,
  workerEndpointResolver,
}: {
  window: BrowserWindow
  userDataPath: string
  workerEndpointResolver: ControlSurfaceRemoteEndpointResolver | null
}): { dispose: () => void } {
  let storePromise: Promise<PersistenceStore> | null = null
  let cachedSettings: CachedQuickPhraseSettings | null = null

  const getStore = async (): Promise<PersistenceStore> => {
    if (storePromise) {
      return await storePromise
    }

    storePromise = workerEndpointResolver
      ? Promise.resolve(createRemotePersistenceStore(workerEndpointResolver))
      : createPersistenceStore({ dbPath: resolve(userDataPath, 'opencove.db') })

    return await storePromise
  }

  const handler = (event: Electron.Event, params: Electron.ContextMenuParams): void => {
    if (!params.isEditable) {
      return
    }

    event.preventDefault()

    void (async () => {
      const editFlags = params.editFlags ?? {}

      const template: MenuItemConstructorOptions[] = [
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        ...(process.platform === 'darwin'
          ? ([{ role: 'pasteAndMatchStyle', enabled: editFlags.canPaste }] as const)
          : []),
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll },
      ]

      let settings = cachedSettings
      if (!settings || Date.now() - settings.cachedAtMs > QUICK_PHRASES_CACHE_TTL_MS) {
        try {
          settings = await resolveQuickPhraseSettings(await getStore())
          cachedSettings = settings
        } catch {
          settings = cachedSettings
        }
      }

      const enabledPhrases = (settings?.phrases ?? []).filter(phrase => phrase.enabled)
      if (enabledPhrases.length > 0) {
        template.push({ type: 'separator' })
        template.push({
          label: resolveQuickPhrasesSubmenuLabel(settings?.language ?? ''),
          submenu: enabledPhrases.map(phrase => ({
            label: phrase.title,
            click: () => {
              if (window.isDestroyed()) {
                return
              }

              try {
                if (!window.webContents.isDestroyed()) {
                  window.webContents.insertText(phrase.content)
                }
              } catch (error) {
                void error
              }
            },
          })),
        })
      }

      if (window.isDestroyed()) {
        return
      }

      try {
        const menu = Menu.buildFromTemplate(template)
        menu.popup({ window })
      } catch (error) {
        void error
      }
    })()
  }

  window.webContents.on('context-menu', handler)

  return {
    dispose: () => {
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.removeListener('context-menu', handler)
        }
      } catch (error) {
        void error
      }

      const disposableStorePromise = storePromise
      storePromise = null
      cachedSettings = null

      void disposableStorePromise
        ?.then(store => {
          try {
            store.dispose()
          } catch (error) {
            void error
          }
        })
        .catch(error => {
          void error
        })
    },
  }
}
