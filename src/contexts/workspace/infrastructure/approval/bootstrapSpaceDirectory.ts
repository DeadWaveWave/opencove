import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { MountDto } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

function invalidDirectory(): never {
  throw createAppError('common.invalid_input', {
    debugMessage: 'Space directory must be an existing directory within its default mount.',
  })
}

/** The path implementation belongs to the executing endpoint, never the caller. */
export function relativeDirectoryWithinRoot(
  root: string,
  target: string,
  paths: typeof path = path,
): string {
  if (!paths.isAbsolute(root) || !paths.isAbsolute(target)) {
    return invalidDirectory()
  }
  const relative = paths.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)) {
    return invalidDirectory()
  }
  return relative
}

export async function validateBootstrapSpaceDirectory(
  mount: MountDto,
  directoryPath?: string,
): Promise<string> {
  if (mount.endpointId !== 'local') {
    // Startup approval currently interprets persisted directories as local roots.
    // Until it preserves endpoint identity, even a remote default root is unsafe.
    return invalidDirectory()
  }
  const requested = directoryPath ?? mount.rootPath
  relativeDirectoryWithinRoot(mount.rootPath, requested)
  try {
    const [root, target] = await Promise.all([realpath(mount.rootPath), realpath(requested)])
    const relative = relativeDirectoryWithinRoot(root, target)
    if (!(await stat(target)).isDirectory()) {
      return invalidDirectory()
    }
    // Keep the mount's spelling so mount-context resolution retains the binding.
    // Internal symlinks are replaced by their canonical relative destination.
    return path.resolve(mount.rootPath, relative)
  } catch {
    return invalidDirectory()
  }
}
