import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { TerminalAgentAssetFiles } from './TerminalAgentAssetFiles'
import {
  terminalAgentAssetManifest,
  terminalAgentAssetPaths,
} from './TerminalAgentTelemetryAssetManifest'
import {
  emitTerminalAgentDiagnostic,
  type TerminalAgentDiagnosticSink,
} from './TerminalAgentDiagnostics'

export interface TerminalAgentTelemetryAssets {
  readonly bashRcPath: string
  readonly launcherPath: string
  readonly planDirectory: string
  readonly rootDirectory: string
  readonly shellLauncherPath: string
  readonly shimDirectory: string
  readonly zshDotDirectory: string
}

export class TerminalAgentTelemetryAssetStore {
  private readonly files: TerminalAgentAssetFiles
  private readonly assets: TerminalAgentTelemetryAssets
  private ensurePromise: Promise<TerminalAgentTelemetryAssets> | null = null
  private disposePromise: Promise<void> | null = null
  private disposed = false
  private published = false

  public constructor(
    private readonly options: {
      parentDirectory: string
      trustedDirectory?: string
      platform: NodeJS.Platform
      runtimeExecutable: string
      diagnostic?: TerminalAgentDiagnosticSink
    },
  ) {
    this.assets = Object.freeze(
      terminalAgentAssetPaths(join(options.parentDirectory, `instance-${randomUUID()}`)),
    )
    this.files = new TerminalAgentAssetFiles(
      options.parentDirectory,
      this.assets.rootDirectory,
      options.trustedDirectory,
    )
  }

  public async ensure(): Promise<TerminalAgentTelemetryAssets> {
    if (this.disposed) {
      throw new Error('Terminal Agent assets disposed')
    }
    if (!this.ensurePromise) {
      this.ensurePromise = this.validateAndRepair().finally(() => {
        this.ensurePromise = null
      })
    }
    return await this.ensurePromise
  }

  public dispose(): Promise<void> {
    this.disposed = true
    this.disposePromise ??= (async () => {
      await this.ensurePromise?.catch(() => undefined)
      await this.files.dispose()
    })()
    return this.disposePromise
  }

  private async validateAndRepair(): Promise<TerminalAgentTelemetryAssets> {
    const { rootDirectory, shimDirectory, planDirectory, zshDotDirectory } = this.assets
    await this.files.ensureDirectories([
      rootDirectory,
      shimDirectory,
      planDirectory,
      zshDotDirectory,
    ])
    let repaired = 0
    // Serial effects: no sibling write may outlive a rejected ensure and race cleanup/retry.
    for (const file of terminalAgentAssetManifest(this.assets, this.options.runtimeExecutable)) {
      // eslint-disable-next-line no-await-in-loop -- rejected work must leave no pending sibling writes
      if (await this.files.ensureFile(file)) {
        repaired++
      }
    }
    if (this.disposed) {
      throw new Error('Terminal Agent assets disposed')
    }
    if (this.published && repaired > 0) {
      emitTerminalAgentDiagnostic(this.options.diagnostic, {
        type: 'assets-repaired',
        count: repaired,
      })
    }
    this.published = true
    return this.assets
  }
}
