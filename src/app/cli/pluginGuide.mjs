import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_GUIDE_DOCUMENTS = [
  'README.md',
  'AUTHORING.md',
  'API.md',
  'COMMANDS.md',
  'RUNTIME.md',
  'VISUAL_DESIGN.md',
  'HOST_API.md',
  'HOST_EXTENSIONS.md',
  'THEMES.md',
  'FILESYSTEM.md',
  'CANVAS_API.md',
  'EVENTS.md',
  'SIDEBAR.md',
  'TARGETS.md',
  'COMPATIBILITY.md',
  'DISTRIBUTION.md',
  'ROADMAP.md',
  ...[
    'opencove.plugin.json',
    'README.md',
    'main.mjs',
    'index.html',
    'view.js',
    'style.css',
    'icon.svg',
  ].map(filename => `examples/hello-clock/${filename}`),
]

/**
 * Resolve the versioned plugin documentation next to the packaged CLI.
 *
 * electron-builder keeps `src/app/cli` and `docs/plugins` at the same app
 * root, whether that root is app.asar or an unpacked `app` directory. Keeping
 * this calculation relative to the CLI also makes the source checkout and the
 * packaged app locate the same documentation. Archive paths must be exported
 * before returning them to shell tools, which cannot read Electron's virtual FS.
 */
export function resolvePluginGuideDirectory(scriptPath = fileURLToPath(import.meta.url)) {
  return join(dirname(scriptPath), '..', '..', '..', 'docs', 'plugins')
}

async function isArchiveDirectory(directory) {
  // Electron's patched stat reports an archive itself as a directory. Use the
  // underlying filesystem to distinguish a real archive from a source folder
  // that happens to end in .asar. Plain Node never exposes a virtual archive.
  if (!process.versions.electron) {
    return false
  }
  const originalFs = createRequire(import.meta.url)('original-fs').promises
  for (const match of directory.matchAll(/\.asar(?=[\\/]|$)/giu)) {
    const candidate = directory.slice(0, match.index + '.asar'.length)
    // eslint-disable-next-line no-await-in-loop -- Stop at the first real archive; deeper paths are virtual.
    if ((await originalFs.stat(candidate)).isFile()) {
      return true
    }
  }
  return false
}

async function readGuideFiles(directory) {
  const files = []
  const visit = async (parent, relativeDirectory = '') => {
    const entries = await readdir(parent, { withFileTypes: true })
    await Promise.all(
      entries.map(async entry => {
        const path = join(parent, entry.name)
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          await visit(path, relativePath)
        } else if (entry.isFile()) {
          files.push({ path: relativePath, contents: await readFile(path) })
        } else {
          throw new Error(`Plugin guide contains an unsupported file: ${path}`)
        }
      }),
    )
  }
  await visit(directory)
  for (const required of REQUIRED_GUIDE_DOCUMENTS) {
    if (!files.some(file => file.path === required && file.contents.length > 0)) {
      throw new Error(
        `Required plugin guide document is missing or empty: ${join(directory, required)}`,
      )
    }
  }
  return files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

function digestGuideFiles(files) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        files.map(file => [file.path, createHash('sha256').update(file.contents).digest('hex')]),
      ),
    )
    .digest('hex')
}

async function verifyCachedGuide(directory, digest) {
  const entry = await lstat(directory)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`Plugin guide cache is not a directory: ${directory}`)
  }
  if (digestGuideFiles(await readGuideFiles(directory)) !== digest) {
    throw new Error(`Plugin guide cache contents have changed: ${directory}`)
  }
}

async function exportGuideFiles(files, cacheDirectory) {
  const digest = digestGuideFiles(files)
  const destination = join(cacheDirectory, digest)
  let exists = true
  try {
    await lstat(destination)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
    exists = false
  }
  if (exists) {
    await verifyCachedGuide(destination, digest)
    return destination
  }

  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(cacheDirectory, '.staging-'))
  try {
    const writes = await Promise.allSettled(
      files.map(async file => {
        const path = join(staging, file.path)
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await writeFile(path, file.contents, { flag: 'wx', mode: 0o600 })
      }),
    )
    const failedWrite = writes.find(result => result.status === 'rejected')
    if (failedWrite) {
      throw failedWrite.reason
    }
    try {
      await rename(staging, destination)
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) {
        throw error
      }
      // Another guide process may have published this same immutable snapshot.
    }
    await verifyCachedGuide(destination, digest)
    return destination
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export async function createPluginGuideResult(
  pluginDirectory = resolvePluginGuideDirectory(),
  { cacheDirectory = join(homedir(), '.opencove', 'cache', 'plugin-guides') } = {},
) {
  try {
    const files = await readGuideFiles(pluginDirectory)
    const directory = (await isArchiveDirectory(pluginDirectory))
      ? await exportGuideFiles(files, resolve(cacheDirectory))
      : pluginDirectory
    return {
      directory,
      readme: join(directory, 'README.md'),
    }
  } catch (error) {
    throw new Error(`Plugin guide unavailable at ${pluginDirectory}: ${error.message}`, {
      cause: error,
    })
  }
}
