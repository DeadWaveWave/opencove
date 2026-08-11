import { cp } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

export async function copyRuntimePreservingSymlinks(sourcePath, destinationPath) {
  // Electron frameworks rely on relocatable relative symlink chains. Node otherwise resolves
  // their targets while copying, embedding the release runner's absolute workspace path.
  await cp(sourcePath, destinationPath, {
    recursive: true,
    verbatimSymlinks: true,
  })
}

export function createTarArchive({ cwd, outputPath, sourceDirName, spawnSyncImpl = spawnSync }) {
  const result = spawnSyncImpl('tar', ['-czf', outputPath, sourceDirName], {
    cwd,
    encoding: 'utf8',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || 'tar failed'
    throw new Error(detail)
  }
}
