import { compilePluginThemeResources } from './compilePluginThemeResources'
import type { PluginThemeResources } from '../domain/pluginThemeResources'
import { readPluginGitSource } from '../domain/pluginDistributionValidation'
import { assertPluginCompatibility } from '../domain/pluginCompatibility'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, posix, resolve, sep } from 'node:path'
import {
  normalizeLocalPluginPackage,
  pluginRecord,
  pluginRelativePath,
} from '../domain/localPluginValidation'
import type {
  PluginFilesPort,
  PluginInstallationRecord,
  PluginResource,
  PluginSnapshot,
} from '../application/PluginRuntimePorts'

const MAX_BYTES = 64 * 1024 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_FILES = 2000

export function pluginContentType(path: string): string {
  const extensions: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.md': 'text/plain; charset=utf-8',
  }
  return extensions[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

export async function writePluginJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

export class LocalPluginFiles implements PluginFilesPort {
  private readonly root: string
  constructor(
    userDataPath: string,
    private readonly platform = process.platform,
    private readonly hostVersion: string | null = null,
  ) {
    this.root = resolve(userDataPath, 'plugins')
  }

  async readRegistry(): Promise<PluginInstallationRecord[]> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(join(this.root, 'installed.json'), 'utf8'))
    } catch (error) {
      if (missing(error)) {
        return []
      }
      throw new Error(`Cannot read installed plugin registry: ${String(error)}`, { cause: error })
    }
    const registry = pluginRecord(raw)
    if (registry.version !== 1 || !Array.isArray(registry.plugins)) {
      throw new Error('Unsupported plugin registry format.')
    }
    const ids = new Set<string>()
    return registry.plugins.map(value => {
      const record = pluginRecord(value)
      const pkg = normalizeLocalPluginPackage(record.package)
      if (ids.has(pkg.id)) {
        throw new Error('Duplicate plugin installation id.')
      }
      ids.add(pkg.id)
      if (
        typeof record.sourceDirectory !== 'string' ||
        !record.sourceDirectory ||
        typeof record.revision !== 'string' ||
        !/^[a-f0-9]{64}$/.test(record.revision) ||
        typeof record.enabled !== 'boolean'
      ) {
        throw new Error('Invalid installed plugin record.')
      }
      const history =
        record.history === undefined
          ? undefined
          : (() => {
              if (!Array.isArray(record.history) || record.history.length > 20) {
                throw new Error('Invalid plugin code history.')
              }
              return record.history.map(previousValue => {
                const item = pluginRecord(previousValue)
                const previous = normalizeLocalPluginPackage(item.package)
                if (
                  previous.id !== pkg.id ||
                  typeof item.sourceDirectory !== 'string' ||
                  typeof item.revision !== 'string' ||
                  !/^[a-f0-9]{64}$/.test(item.revision)
                ) {
                  throw new Error('Invalid plugin code history entry.')
                }
                return {
                  package: previous,
                  sourceDirectory: item.sourceDirectory,
                  revision: item.revision,
                  ...(item.distribution
                    ? { distribution: readPluginGitSource(item.distribution) }
                    : {}),
                }
              })
            })()
      return {
        package: pkg,
        sourceDirectory: record.sourceDirectory,
        revision: record.revision,
        enabled: record.enabled,
        ...(record.distribution ? { distribution: readPluginGitSource(record.distribution) } : {}),
        ...(history ? { history } : {}),
      }
    })
  }

  async writeRegistry(records: PluginInstallationRecord[]): Promise<void> {
    await writePluginJson(join(this.root, 'installed.json'), { version: 1, plugins: records })
  }

  async snapshot(directory: string): Promise<PluginSnapshot> {
    const sourceDirectory = await realpath(resolve(directory))
    if (!(await stat(sourceDirectory)).isDirectory()) {
      throw new Error('Plugin source must be a directory.')
    }
    // Prevent a source containing the destination tree from recursively capturing runtime artifacts.
    if (this.root === sourceDirectory || this.root.startsWith(`${sourceDirectory}${sep}`)) {
      throw new Error('Plugin source cannot contain the OpenCove plugin data directory.')
    }
    const temporary = join(this.root, 'candidates', randomUUID())
    await mkdir(temporary, { recursive: true })
    let bytes = 0
    let count = 0
    const digest = createHash('sha256').update(randomUUID())
    // Serial reads enforce the total byte budget without unbounded buffers or hash ordering races.
    /* eslint-disable no-await-in-loop */
    const copy = async (relative: string): Promise<void> => {
      const entries = await readdir(join(sourceDirectory, relative), { withFileTypes: true })
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.DS_Store') {
          continue
        }
        const path = relative ? `${relative}/${entry.name}` : entry.name
        if (entry.isSymbolicLink()) {
          throw new Error(`Plugin symlinks are not supported: ${path}`)
        }
        if (entry.isDirectory()) {
          await mkdir(join(temporary, path), { recursive: true })
          await copy(path)
          continue
        }
        if (!entry.isFile()) {
          throw new Error(`Unsupported plugin file: ${path}`)
        }
        count += 1
        const info = await stat(join(sourceDirectory, path))
        bytes += info.size
        if (info.size > MAX_FILE_BYTES || bytes > MAX_BYTES || count > MAX_FILES) {
          throw new Error(
            'Plugin exceeds the 64 MiB / 2000 files / 16 MiB per-file limit. Install its bundled distribution directory.',
          )
        }
        const content = await readFile(join(sourceDirectory, path))
        if (content.length !== info.size) {
          throw new Error('Plugin source changed while copying; retry reload.')
        }
        digest.update(`${path}\0${content.length}\0`)
        digest.update(content)
        await writeFile(join(temporary, path), content, { mode: 0o600 })
      }
    }
    /* eslint-enable no-await-in-loop */
    try {
      await copy('')
      const pkg = normalizeLocalPluginPackage(
        JSON.parse(await readFile(join(temporary, 'opencove.plugin.json'), 'utf8')),
      )
      assertPluginCompatibility(pkg, { version: this.hostVersion, platform: this.platform })
      const required = [
        pkg.view?.entry,
        pkg.main,
        pkg.preview,
        pkg.readme,
        ...(pkg.contributes?.skills?.map(skill => skill.path) ?? []),
      ]
      if (pkg.icon?.type === 'asset') {
        required.push(pkg.icon.path, pkg.icon.light, pkg.icon.dark)
      }
      await Promise.all(
        required
          .filter((path): path is string => Boolean(path))
          .map(async path => {
            if (!(await stat(join(temporary, pluginRelativePath(path)))).isFile()) {
              throw new Error(`Plugin entry is not a file: ${path}`)
            }
          }),
      )
      await compilePluginThemeResources(temporary, pkg.id, pkg.contributes?.themes)
      const revision = digest.digest('hex')
      const artifact = join(this.root, 'artifacts', revision)
      await mkdir(dirname(artifact), { recursive: true })
      try {
        await rename(temporary, artifact)
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw error
        }
        await rm(temporary, { recursive: true, force: true })
      }
      return { package: pkg, sourceDirectory, revision, enabled: true, directory: artifact }
    } catch (error) {
      await rm(temporary, { recursive: true, force: true })
      throw error
    }
  }

  async restore(record: PluginInstallationRecord): Promise<PluginSnapshot> {
    assertPluginCompatibility(record.package, {
      version: this.hostVersion,
      platform: this.platform,
    })
    const directory = join(this.root, 'artifacts', record.revision)
    const artifact = normalizeLocalPluginPackage(
      JSON.parse(await readFile(join(directory, 'opencove.plugin.json'), 'utf8')),
    )
    if (JSON.stringify(artifact) !== JSON.stringify(record.package)) {
      throw new Error('Plugin artifact manifest does not match its installed record.')
    }
    await compilePluginThemeResources(directory, artifact.id, artifact.contributes?.themes)
    return { ...record, directory }
  }

  async readResource(snapshot: PluginSnapshot, relative: string): Promise<PluginResource> {
    const path = pluginRelativePath(relative)
    const file = await realpath(join(snapshot.directory, path))
    const root = await realpath(snapshot.directory)
    if (!file.startsWith(`${root}${sep}`)) {
      throw new Error('Plugin resource escaped its artifact.')
    }
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) {
      throw new Error('Invalid plugin resource.')
    }
    return { body: await readFile(file), contentType: pluginContentType(path) }
  }

  async readDetails(
    snapshot: PluginSnapshot,
  ): Promise<{ readme: string; assets: Record<string, string> } & PluginThemeResources> {
    const path = snapshot.package.readme ?? 'README.md'
    let readme = ''
    try {
      readme = Buffer.from((await this.readResource(snapshot, path)).body).toString('utf8')
    } catch (error) {
      if (!missing(error)) {
        throw error
      }
    }
    const assets: Record<string, string> = {}
    const candidates = new Map<string, string>()
    if (snapshot.package.icon?.type === 'asset') {
      for (const candidate of [
        snapshot.package.icon.path,
        snapshot.package.icon.light,
        snapshot.package.icon.dark,
      ]) {
        if (candidate) {
          candidates.set(candidate, candidate)
        }
      }
    }
    for (const match of readme.matchAll(/!\[[^\]]*\]\(\s*([^\s)]+)(?:\s+[^)]*)?\)/g)) {
      if (!/^[a-z]+:|^\/\//i.test(match[1])) {
        candidates.set(match[1], posix.join(posix.dirname(path), match[1]))
      }
    }
    let total = 0
    // Stop loading images as soon as the shared response budget is exhausted.
    /* eslint-disable no-await-in-loop */
    for (const [candidate, assetPath] of [...candidates].slice(0, 32)) {
      try {
        const normalized = pluginRelativePath(assetPath)
        if (!/\.(svg|png|webp|jpe?g|gif)$/i.test(normalized)) {
          continue
        }
        const resource = await this.readResource(snapshot, normalized)
        total += resource.body.byteLength
        if (total > 4 * 1024 * 1024) {
          break
        }
        const url = `data:${resource.contentType};base64,${Buffer.from(resource.body).toString('base64')}`
        assets[candidate] = url
        assets[normalized] = url
        assets[`./${normalized}`] = url
      } catch {
        /* Broken optional images remain normal Markdown fallbacks. */
      }
    }
    /* eslint-enable no-await-in-loop */
    const themes = await compilePluginThemeResources(
      snapshot.directory,
      snapshot.package.id,
      snapshot.package.contributes?.themes,
    )
    return { readme, assets, ...themes }
  }

  async readSkill(
    snapshot: PluginSnapshot,
    path: string,
  ): Promise<{ content: string; path: string }> {
    const resource = await this.readResource(snapshot, path)
    if (resource.body.byteLength > 128 * 1024) {
      throw new Error('Plugin skill exceeds 128 KiB.')
    }
    return {
      content: Buffer.from(resource.body).toString('utf8'),
      path: await realpath(join(snapshot.directory, pluginRelativePath(path))),
    }
  }

  dataDirectory(pluginId: string): string {
    return join(this.root, 'state', pluginId)
  }
  async removePreviewData(pluginId: string, viewId: string): Promise<void> {
    await rm(join(this.dataDirectory(pluginId), 'previews', basename(viewId)), {
      recursive: true,
      force: true,
    })
  }
  async readStorage(pluginId: string, key: string): Promise<unknown> {
    try {
      return JSON.parse(
        await readFile(
          join(this.dataDirectory(pluginId), 'storage', `${storageKey(key)}.json`),
          'utf8',
        ),
      )
    } catch (error) {
      if (missing(error)) {
        return null
      }
      throw error
    }
  }
  async writeStorage(pluginId: string, key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value)
    if (json === undefined || json.length > 1024 * 1024) {
      throw new Error('Plugin storage values must be JSON under 1 MiB.')
    }
    await writePluginJson(
      join(this.dataDirectory(pluginId), 'storage', `${storageKey(key)}.json`),
      value,
    )
  }
}

function storageKey(key: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(key)) {
    throw new Error('Invalid plugin storage key.')
  }
  return key
}
