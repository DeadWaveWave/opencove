// Single source of production build entries, as repo-relative paths.
// electron-vite, the CLI build and knip (knip.config.ts) all read this file, so a new entry
// added here is built and analysed for dead code without any other edit.
// Files that production loads only by a path string (spawned processes, workers) belong here.

export const MAIN_ENTRIES = {
  index: 'src/app/main/index.ts',
  worker: 'src/app/worker/index.ts',
  pluginHost: 'src/contexts/plugins/infrastructure/pluginHostEntry.ts',
  managedRuntime: 'src/app/managedRuntime/index.ts',
  ptyHost: 'src/platform/process/ptyHost/entry.ts',
  windowsConsoleObserver: 'src/platform/process/ptyHost/windowsConsoleObserverEntry.ts',
}

export const PRELOAD_ENTRIES = {
  index: 'src/app/preload/index.ts',
}

export const RENDERER_ROOT = 'src/app/renderer'

export const RENDERER_HTML_ENTRIES = {
  index: 'src/app/renderer/index.html',
  web: 'src/app/renderer/web.html',
}

export const CLI_ENTRY = 'src/app/cli/main.ts'
