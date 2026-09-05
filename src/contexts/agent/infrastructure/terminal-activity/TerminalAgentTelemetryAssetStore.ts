import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

export interface TerminalAgentTelemetryAssets {
  bashRcPath: string
  launcherPath: string
  planDirectory: string
  rootDirectory: string
  shellLauncherPath: string
  shimDirectory: string
  zshDotDirectory: string
}

export class TerminalAgentTelemetryAssetStore {
  private assets: TerminalAgentTelemetryAssets | null = null
  private ensurePromise: Promise<TerminalAgentTelemetryAssets> | null = null

  public constructor(
    private readonly options: {
      platform: NodeJS.Platform
      runtimeExecutable: string
    },
  ) {}

  public async ensure(): Promise<TerminalAgentTelemetryAssets> {
    if (this.assets) {
      return this.assets
    }
    if (!this.ensurePromise) {
      const nextEnsure = this.createAssets().catch(error => {
        if (this.ensurePromise === nextEnsure) {
          this.ensurePromise = null
        }
        throw error
      })
      this.ensurePromise = nextEnsure
    }
    return await this.ensurePromise
  }

  public async dispose(): Promise<void> {
    const assets = this.assets
    this.assets = null
    this.ensurePromise = null
    if (assets) {
      await rm(assets.rootDirectory, { recursive: true, force: true })
    }
  }

  private async createAssets(): Promise<TerminalAgentTelemetryAssets> {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'opencove-terminal-agent-'))
    try {
      return await this.populateAssets(rootDirectory)
    } catch (error) {
      await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  private async populateAssets(rootDirectory: string): Promise<TerminalAgentTelemetryAssets> {
    await chmod(rootDirectory, 0o700)
    const shimDirectory = join(rootDirectory, 'bin')
    const planDirectory = join(rootDirectory, 'plans')
    const zshDotDirectory = join(rootDirectory, 'zsh')
    await mkdir(shimDirectory, { mode: 0o700 })
    await mkdir(planDirectory, { mode: 0o700 })
    await mkdir(zshDotDirectory, { mode: 0o700 })
    const launcherPath = join(rootDirectory, 'launcher.mjs')
    const shellLauncherPath = join(rootDirectory, 'shell-launcher.sh')
    const bashRcPath = join(rootDirectory, 'bashrc')
    await writePrivateFile(launcherPath, terminalAgentLauncherScript, 0o700)
    await writePrivateFile(shellLauncherPath, terminalAgentPosixShellLauncherScript, 0o700)
    await writePrivateFile(bashRcPath, terminalAgentBashRcScript, 0o600)
    await writePrivateFile(join(zshDotDirectory, '.zshenv'), terminalAgentZshEnvScript, 0o600)
    await writePrivateFile(join(zshDotDirectory, '.zprofile'), terminalAgentZshProfileScript, 0o600)
    await writePrivateFile(join(zshDotDirectory, '.zshrc'), terminalAgentZshRcScript, 0o600)
    await writePrivateFile(join(zshDotDirectory, '.zlogin'), terminalAgentZshLoginScript, 0o600)

    await Promise.all(
      (['claude', 'codex', 'pi'] as const).flatMap(provider => {
        const powerShellPath = join(shimDirectory, `${provider}.ps1`)
        return [
          writePrivateFile(
            join(shimDirectory, provider),
            createPosixShimScript(this.options.runtimeExecutable, launcherPath, provider),
            0o700,
          ),
          writePrivateFile(
            powerShellPath,
            createPowerShellShimScript(
              this.options.runtimeExecutable,
              launcherPath,
              provider,
              planDirectory,
            ),
            0o700,
          ),
          writePrivateFile(
            join(shimDirectory, `${provider}.cmd`),
            createCmdShimScript(powerShellPath),
            0o700,
          ),
        ]
      }),
    )

    const assets = {
      bashRcPath,
      launcherPath,
      planDirectory,
      rootDirectory,
      shellLauncherPath,
      shimDirectory,
      zshDotDirectory,
    }
    this.assets = assets
    return assets
  }
}

async function writePrivateFile(path: string, content: string, mode: number): Promise<void> {
  await writeFile(path, content, { encoding: 'utf8', mode, flag: 'wx' })
  await chmod(path, mode)
}
