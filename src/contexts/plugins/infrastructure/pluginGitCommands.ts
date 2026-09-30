import { pluginBuildInvocation } from './pluginBuildInvocation'
import { getCommandEnvironmentSnapshot } from '@platform/os/CommandEnvironmentService'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, lstat, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
const execute = promisify(execFile)
export async function git(directory: string, args: string[]): Promise<string> {
  const { stdout } = await execute(
    'git',
    [
      '-c',
      'core.hooksPath=',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'protocol.ext.allow=never',
      '-C',
      directory,
      ...args,
    ],
    {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_OPTIONAL_LOCKS: '0',
      },
    },
  )
  return stdout.trimEnd()
}
export async function runBuild(
  directory: string,
  manager: 'npm' | 'pnpm',
  script: string,
): Promise<void> {
  const frozen =
    manager === 'npm'
      ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
      : ['install', '--frozen-lockfile', '--ignore-scripts']
  const invocation = await pluginBuildInvocation(manager)
  const { env } = await getCommandEnvironmentSnapshot()
  const options = { cwd: directory, timeout: 180_000, maxBuffer: 1024 * 1024, env }
  await execute(invocation.command, [...invocation.args, ...frozen], options)
  await execute(invocation.command, [...invocation.args, 'run', script], options)
}
export async function within(directory: string, path: string): Promise<string> {
  const root = await realpath(directory)
  const target = await realpath(resolve(root, path))
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error('Build directory escapes the source checkout.')
  }
  return target
}
/** Copy working files into an isolated clone; the original index and files remain untouched. */
export async function copyPersonalSource(source: string, candidate: string): Promise<void> {
  if (await git(source, ['ls-files', '--unmerged'])) {
    throw new Error('Resolve source checkout conflicts before preparing an update.')
  }
  const paths = new Set(
    [
      await git(source, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
      await git(source, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']),
    ]
      .flatMap(list => list.split('\0'))
      .filter(Boolean),
  )
  let bytes = 0
  if (paths.size > 5000) {
    throw new Error('Source checkout exceeds 5000 nonignored files.')
  }
  // Bound source IO and enforce the shared byte budget in deterministic path order.
  /* eslint-disable no-await-in-loop */
  for (const path of paths) {
    const resolved = resolve(source, path)
    if (relative(source, resolved).startsWith('..') || path.split('/').includes('.git')) {
      throw new Error('Invalid source path.')
    }
    const target = join(candidate, path)
    let info
    try {
      info = await lstat(resolved)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await rm(target, { force: true })
        continue
      }
      throw error
    }
    if (!info.isFile()) {
      throw new Error(`Source symlinks/submodules/special files are unsupported: ${path}`)
    }
    bytes += info.size
    if (bytes > 64 * 1024 * 1024 || info.size > 16 * 1024 * 1024) {
      throw new Error('Editable source exceeds the source snapshot budget.')
    }
    const content = await readFile(resolved)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, { mode: info.mode })
    await chmod(target, info.mode)
  }
  /* eslint-enable no-await-in-loop */
  await git(candidate, ['add', '--all'])
  if (await git(candidate, ['diff', '--cached', '--name-only'])) {
    await git(candidate, [
      '-c',
      'user.name=OpenCove',
      '-c',
      'user.email=plugins@opencove.local',
      'commit',
      '-m',
      'Preserve personal plugin source for update',
    ])
  }
}

export async function sourceFingerprint(directory: string): Promise<string> {
  const digest = createHash('sha256')
    .update(await git(directory, ['rev-parse', 'HEAD']))
    .update(await git(directory, ['ls-files', '--stage', '-z']))
  const paths = [
    ...new Set(
      (await git(directory, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
        .split('\0')
        .filter(Boolean),
    ),
  ].sort()
  let bytes = 0
  if (paths.length > 5000) {
    throw new Error('Source exceeds the file budget.')
  }
  /* eslint-disable no-await-in-loop */
  for (const path of paths) {
    const file = join(directory, path)
    const info = await lstat(file).catch(error => {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    })
    digest.update(path + '\0')
    if (!info) {
      digest.update('deleted')
      continue
    }
    if (!info.isFile()) {
      throw new Error('Source symlinks/submodules are unsupported.')
    }
    bytes += info.size
    if (bytes > 64 * 1024 * 1024 || info.size > 16 * 1024 * 1024) {
      throw new Error('Source exceeds the byte budget.')
    }
    digest.update(String(info.mode)).update(await readFile(file))
  }
  /* eslint-enable no-await-in-loop */
  return digest.digest('hex')
}
