import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { TerminalAgentAssetFile } from './TerminalAgentTelemetryAssetManifest'

function unsafe(): never {
  throw Object.assign(new Error('Unsafe terminal Agent asset'), { code: 'UNSAFE_ASSET' })
}

async function inspect(path: string): Promise<Stats | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function checkOwner(info: Stats): void {
  if (process.getuid && info.uid !== process.getuid()) {
    unsafe()
  }
}

// Filesystem effects only. Admission, single-flight work and disposal belong to AssetStore.
export class TerminalAgentAssetFiles {
  private readonly directories = new Map<string, Stats>()
  private canonicalParent: string | null = null

  public constructor(
    private readonly parent: string,
    private readonly root: string,
    private readonly trustedDirectory = parent,
  ) {}

  public async ensureDirectories(paths: readonly string[]): Promise<void> {
    await this.ensureParent()
    for (const path of paths) {
      // eslint-disable-next-line no-await-in-loop -- each child requires its verified parent first
      let info = await inspect(path)
      if (!info) {
        // eslint-disable-next-line no-await-in-loop -- creation and ownership registration must finish together
        await mkdir(path, { mode: 0o700 })
        // eslint-disable-next-line no-await-in-loop -- capture identity before validating the next directory
        info = await lstat(path)
        this.directories.set(path, info)
      }
      this.checkDirectory(path, info)
    }
  }

  public async ensureFile(file: TerminalAgentAssetFile): Promise<boolean> {
    await this.assertParent()
    this.checkDirectory(this.root, await lstat(this.root))
    this.checkDirectory(dirname(file.path), await lstat(dirname(file.path)))
    const info = await inspect(file.path)
    if (info) {
      checkOwner(info)
      if (!info.isFile() || info.nlink !== 1) {
        unsafe()
      }
      if (await this.matches(file, info)) {
        return false
      }
    }
    const staging = join(dirname(file.path), `.repair-${randomUUID()}`)
    const handle = await open(staging, 'wx', file.mode)
    try {
      try {
        await handle.writeFile(file.content, 'utf8')
        if (process.platform !== 'win32') {
          await handle.chmod(file.mode)
        }
      } finally {
        await handle.close()
      }
      await rename(staging, file.path)
    } finally {
      await rm(staging, { force: true })
    }
    return true
  }

  public async dispose(): Promise<void> {
    if (!this.directories.has(this.root)) {
      return
    }
    await this.assertParent()
    const info = await inspect(this.root)
    if (!info) {
      return
    }
    this.checkDirectory(this.root, info)
    // rm removes child symlinks themselves; it does not traverse them.
    await rm(this.root, { recursive: true, force: true })
  }

  private checkDirectory(path: string, info: Stats): void {
    checkOwner(info)
    const owned = this.directories.get(path)
    if (!info.isDirectory() || !owned || !sameFile(owned, info)) {
      unsafe()
    }
    // Do not chmod an unexpected directory or follow a link to fix permissions.
    if (process.platform !== 'win32' && (info.mode & 0o7777) !== 0o700) {
      unsafe()
    }
  }

  private async ensureParent(): Promise<void> {
    if (this.canonicalParent) {
      await this.assertParent()
      return
    }
    // Canonicalize the configured profile (which may itself be an intentional alias),
    // but never follow links in generated runtime directory segments below it.
    const route = relative(resolve(this.trustedDirectory), resolve(this.parent))
    if (isAbsolute(route) || route === '..' || route.startsWith(`..${sep}`)) {
      unsafe()
    }
    await mkdir(this.trustedDirectory, { recursive: true, mode: 0o700 })
    let directory = await realpath(this.trustedDirectory)
    for (const segment of route.split(sep).filter(Boolean)) {
      directory = join(directory, segment)
      // eslint-disable-next-line no-await-in-loop -- never traverse a segment before checking its parent
      let entry = await inspect(directory)
      if (!entry) {
        try {
          // eslint-disable-next-line no-await-in-loop -- the next segment depends on this directory
          await mkdir(directory, { mode: 0o700 })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error
          }
        }
        // eslint-disable-next-line no-await-in-loop -- inspect the completed mkdir before continuing
        entry = await lstat(directory)
      }
      checkOwner(entry)
      if (!entry.isDirectory()) {
        unsafe()
      }
      if (process.platform !== 'win32' && (entry.mode & 0o022) !== 0) {
        unsafe()
      }
    }
    const info = await lstat(this.parent)
    checkOwner(info)
    if (!info.isDirectory()) {
      unsafe()
    }
    if (process.platform !== 'win32' && (info.mode & 0o022) !== 0) {
      unsafe()
    }
    this.canonicalParent = await realpath(this.parent)
    this.directories.set(this.parent, info)
  }

  private async assertParent(): Promise<void> {
    const info = await lstat(this.parent)
    const owned = this.directories.get(this.parent)
    if (!owned || !sameFile(info, owned) || !info.isDirectory()) {
      unsafe()
    }
    checkOwner(info)
    if (process.platform !== 'win32' && (info.mode & 0o022) !== 0) {
      unsafe()
    }
    if ((await realpath(this.parent)) !== this.canonicalParent) {
      unsafe()
    }
  }

  private async matches(file: TerminalAgentAssetFile, info: Stats): Promise<boolean> {
    const expected = Buffer.from(file.content, 'utf8')
    if (info.size !== expected.length) {
      return false
    }
    if (process.platform !== 'win32' && (info.mode & 0o7777) !== file.mode) {
      return false
    }
    const handle = await open(
      file.path,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    )
    try {
      if (!sameFile(info, await handle.stat())) {
        unsafe()
      }
      // Bound reads even if an external writer grows the file after lstat.
      const buffer = Buffer.alloc(expected.length + 1)
      let offset = 0
      while (offset < buffer.length) {
        // eslint-disable-next-line no-await-in-loop -- the next offset depends on the preceding short read
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
        if (!bytesRead) {
          break
        }
        offset += bytesRead
      }
      return offset === expected.length && buffer.subarray(0, offset).equals(expected)
    } finally {
      await handle.close()
    }
  }
}
