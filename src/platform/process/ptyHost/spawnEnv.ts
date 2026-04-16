export function resolvePtyHostSpawnEnv(optionsEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = optionsEnv ? { ...optionsEnv } : { ...process.env }
  const preserveElectronRunAsNode = optionsEnv?.ELECTRON_RUN_AS_NODE === '1'

  // In PTY-backed UIs we generally want a "real terminal" default. Some Node-based CLIs will
  // disable ANSI colors when `NO_COLOR`/`NODE_DISABLE_COLORS` are inherited from a parent tool
  // (test runners, build tools, etc.). Strip them so agent/terminal sessions can keep color.
  delete env.NO_COLOR
  delete env.NODE_DISABLE_COLORS
  // The app uses ELECTRON_RUN_AS_NODE to run bundled CLI/worker entrypoints via Electron.
  // Leaking it into interactive shells breaks launching Electron-based tooling (including
  // OpenCove dev via electron-vite), but test stubs may opt in explicitly.
  if (!preserveElectronRunAsNode) {
    delete env.ELECTRON_RUN_AS_NODE
  }

  return env
}
