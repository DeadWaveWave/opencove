import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntimeArtifact } from '../../../application/ports/AgentProviderContribution'
import { createAgentLaunchCleanupError } from '../../../application/services/AgentLaunchCleanupError'

export interface TemporaryProviderConfig extends AgentRuntimeArtifact {
  readonly path: string
}

interface TemporaryProviderConfigFileSystem {
  readonly chmod: typeof chmod
  readonly mkdtemp: typeof mkdtemp
  readonly rm: typeof rm
  readonly writeFile: typeof writeFile
}

const nodeFileSystem: TemporaryProviderConfigFileSystem = { chmod, mkdtemp, rm, writeFile }

export async function createTemporaryProviderConfig(
  prefix: string,
  filename: string,
  contents: string,
  fileSystem: TemporaryProviderConfigFileSystem = nodeFileSystem,
): Promise<TemporaryProviderConfig> {
  const directory = await fileSystem.mkdtemp(join(tmpdir(), prefix))
  const path = join(directory, filename)
  try {
    await fileSystem.chmod(directory, 0o700)
    await fileSystem.writeFile(path, contents, { encoding: 'utf8', mode: 0o600 })
  } catch (setupError) {
    try {
      await removeTemporaryProviderDirectory(directory, fileSystem)
    } catch (cleanupError) {
      throw createAgentLaunchCleanupError(
        setupError,
        cleanupError,
        'Temporary Agent Provider config setup and rollback both failed.',
      )
    }
    throw setupError
  }

  let disposed = false
  let disposalPromise: Promise<void> | null = null
  return {
    path,
    dispose() {
      if (disposed) {
        return Promise.resolve()
      }
      if (disposalPromise) {
        return disposalPromise
      }

      const disposal = removeTemporaryProviderDirectory(directory, fileSystem).then(() => {
        disposed = true
      })
      disposalPromise = disposal
      const clearDisposal = (): void => {
        if (disposalPromise === disposal) {
          disposalPromise = null
        }
      }
      void disposal.then(clearDisposal, clearDisposal)
      return disposal
    },
  }
}

function removeTemporaryProviderDirectory(
  directory: string,
  fileSystem: TemporaryProviderConfigFileSystem,
): Promise<void> {
  return fileSystem.rm(directory, { force: true, recursive: true })
}
