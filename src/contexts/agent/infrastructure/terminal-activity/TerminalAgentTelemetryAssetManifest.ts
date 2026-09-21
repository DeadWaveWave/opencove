import { join } from 'node:path'
import {
  createCmdShimScript,
  createPosixShimScript,
  createPowerShellShimScript,
  terminalAgentBashRcScript,
  terminalAgentLauncherScript,
  terminalAgentPosixShellLauncherScript,
  terminalAgentZshEnvScript,
  terminalAgentZshLoginScript,
  terminalAgentZshProfileScript,
  terminalAgentZshRcScript,
} from './TerminalAgentTelemetryScripts'

import type { TerminalAgentTelemetryAssets } from './TerminalAgentTelemetryAssetStore'

export interface TerminalAgentAssetFile {
  path: string
  content: string
  mode: number
}

export function terminalAgentAssetManifest(
  assets: TerminalAgentTelemetryAssets,
  runtime: string,
): TerminalAgentAssetFile[] {
  const {
    launcherPath,
    shellLauncherPath,
    bashRcPath,
    zshDotDirectory,
    shimDirectory,
    planDirectory,
  } = assets
  const file = (path: string, content: string, mode = 0o600): TerminalAgentAssetFile => ({
    path,
    content,
    mode,
  })
  return [
    file(launcherPath, terminalAgentLauncherScript, 0o700),
    file(shellLauncherPath, terminalAgentPosixShellLauncherScript, 0o700),
    file(bashRcPath, terminalAgentBashRcScript),
    file(join(zshDotDirectory, '.zshenv'), terminalAgentZshEnvScript),
    file(join(zshDotDirectory, '.zprofile'), terminalAgentZshProfileScript),
    file(join(zshDotDirectory, '.zshrc'), terminalAgentZshRcScript),
    file(join(zshDotDirectory, '.zlogin'), terminalAgentZshLoginScript),
    ...(['claude', 'codex', 'pi'] as const).flatMap(provider => {
      const powerShellPath = join(shimDirectory, `${provider}.ps1`)
      return [
        file(
          join(shimDirectory, provider),
          createPosixShimScript(runtime, launcherPath, provider),
          0o700,
        ),
        file(
          powerShellPath,
          createPowerShellShimScript(runtime, launcherPath, provider, planDirectory),
          0o700,
        ),
        file(join(shimDirectory, `${provider}.cmd`), createCmdShimScript(powerShellPath), 0o700),
      ]
    }),
  ]
}

export function terminalAgentAssetPaths(rootDirectory: string): TerminalAgentTelemetryAssets {
  return {
    rootDirectory,
    launcherPath: join(rootDirectory, 'launcher.mjs'),
    shellLauncherPath: join(rootDirectory, 'shell-launcher.sh'),
    bashRcPath: join(rootDirectory, 'bashrc'),
    shimDirectory: join(rootDirectory, 'bin'),
    planDirectory: join(rootDirectory, 'plans'),
    zshDotDirectory: join(rootDirectory, 'zsh'),
  }
}
