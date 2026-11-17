import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRuntimeArtifact } from '../../../application/ports/AgentProviderContribution'
import { createAgentLaunchCleanupError } from '../../../application/services/AgentLaunchCleanupError'

declare const agentLaunchArtifactRootBrand: unique symbol

/** App-owned launch storage, constructed from userData only at composition boundaries. */
export type AgentLaunchArtifactRoot = string & { readonly [agentLaunchArtifactRootBrand]: true }

export interface AgentLaunchArtifactFile extends AgentRuntimeArtifact {
  readonly path: string
}

interface AgentLaunchArtifactFileSystem {
  readonly chmod: typeof chmod
  readonly mkdir: typeof mkdir
  readonly mkdtemp: typeof mkdtemp
  readonly rm: typeof rm
  readonly writeFile: typeof writeFile
}

const nodeFileSystem: AgentLaunchArtifactFileSystem = { chmod, mkdir, mkdtemp, rm, writeFile }

export async function createAgentLaunchArtifactFile(
  root: AgentLaunchArtifactRoot,
  prefix: string,
  filename: string,
  contents: string,
  fileSystem: AgentLaunchArtifactFileSystem = nodeFileSystem,
): Promise<AgentLaunchArtifactFile> {
  await fileSystem.mkdir(root, { recursive: true, mode: 0o700 })
  const directory = await fileSystem.mkdtemp(join(root, prefix))
  const path = join(directory, filename)
  try {
    await fileSystem.chmod(directory, 0o700)
    await fileSystem.writeFile(path, contents, { encoding: 'utf8', mode: 0o600 })
  } catch (setupError) {
    try {
      await removeAgentLaunchArtifactDirectory(directory, fileSystem)
    } catch (cleanupError) {
      throw createAgentLaunchCleanupError(
        setupError,
        cleanupError,
        'Agent launch artifact setup and rollback both failed.',
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

      const disposal = removeAgentLaunchArtifactDirectory(directory, fileSystem).then(() => {
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

function removeAgentLaunchArtifactDirectory(
  directory: string,
  fileSystem: AgentLaunchArtifactFileSystem,
): Promise<void> {
  return fileSystem.rm(directory, { force: true, recursive: true })
}
