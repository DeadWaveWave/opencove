import { runTranscriptIO, awaitTranscriptIO } from './ClaudeTranscriptReadBudget'
import { constants, type Stats } from 'node:fs'
import fs from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'

export interface ValidatedTranscriptFile {
  path: string
  dev: number
  ino: number
}
export interface SessionFileAccess {
  validate(signal?: AbortSignal): Promise<ValidatedTranscriptFile>
  open(signal?: AbortSignal): Promise<fs.FileHandle>
}
function inside(root: string, path: string): boolean {
  const part = relative(root, path)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}
function unsafe(): never {
  throw Object.assign(new Error('Unsafe transcript capability'), { code: 'UNSAFE_TRANSCRIPT' })
}
function same(a: Pick<Stats, 'dev' | 'ino'>, b: Pick<Stats, 'dev' | 'ino'>): boolean {
  return a.dev === b.dev && a.ino === b.ino
}
/** Node may return either ordinary or extended-length Windows paths for the same file. */
export function canonicalTranscriptPath(path: string, platform = process.platform): string {
  if (platform !== 'win32') {
    return path
  }
  return win32.normalize(path.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, ''))
}
export type ClaudeTranscriptRoots = () => Promise<readonly string[]>
/** Canonical authority is pinned once per observer; a missing root may be retried on a hook. */
export function claudeTranscriptRoots(roots: readonly string[]): ClaudeTranscriptRoots {
  let cached: Promise<readonly string[]> | undefined
  return () =>
    (cached ??= Promise.all(
      roots.map(async root => {
        try {
          const config = canonicalTranscriptPath(await fs.realpath(resolve(root)))
          const projects = join(config, 'projects'),
            info = await fs.lstat(projects)
          if (!info.isDirectory() || info.isSymbolicLink()) {
            return unsafe()
          }
          const canonical = canonicalTranscriptPath(await fs.realpath(projects))
          if (relative(projects, canonical) !== '') {
            return unsafe()
          }
          return canonical
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined
          }
          throw error
        }
      }),
    )
      .then(values => {
        const found = values.filter((value): value is string => value !== undefined)
        if (!found.length) {
          throw Object.assign(new Error('Transcript roots unavailable'), { code: 'ENOENT' })
        }
        return found
      })
      .catch(error => {
        cached = undefined
        throw error
      }))
}

/**
 * Launch-root/leaf/descriptor checks are defense in depth, not an openat sandbox.
 * Same-user writes replacing parent directories between path operations are outside
 * the threat model: Node exposes no descriptor-relative traversal to make them atomic.
 */
export function claudeTranscriptAccess(
  path: string,
  sessionId: string,
  roots: readonly string[] | ClaudeTranscriptRoots,
): SessionFileAccess {
  const lexical = resolve(canonicalTranscriptPath(path))
  const trusted = typeof roots === 'function' ? roots : claudeTranscriptRoots(roots)
  const validate = async (signal?: AbortSignal): Promise<ValidatedTranscriptFile> => {
    if (
      !isAbsolute(path) ||
      basename(lexical) !== `${sessionId}.jsonl` ||
      !/^[A-Za-z0-9_-]+$/.test(sessionId) ||
      !lexical
        .split(sep)
        .some(part => (process.platform === 'win32' ? part.toLowerCase() : part) === 'projects')
    ) {
      unsafe()
    }
    const candidates = await runTranscriptIO(trusted, signal)
    const info = await runTranscriptIO(() => fs.lstat(lexical), signal)
    if (!info.isFile() || info.isSymbolicLink()) {
      unsafe()
    }
    const canonical = canonicalTranscriptPath(
      await runTranscriptIO(() => fs.realpath(lexical), signal),
    )
    if (
      !candidates.some(root => inside(root, canonical)) ||
      basename(canonical) !== `${sessionId}.jsonl`
    ) {
      unsafe()
    }
    return { path: canonical, dev: info.dev, ino: info.ino }
  }
  return {
    validate,
    open: async signal => {
      const expected = await runTranscriptIO(() => validate(signal), signal)
      const handle = await runTranscriptIO(
        () =>
          fs.open(
            expected.path,
            constants.O_RDONLY |
              (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK),
          ),
        signal,
        lateHandle => {
          void lateHandle.close().catch(() => {})
        },
      )
      try {
        const actual = await runTranscriptIO(() => handle.stat(), signal),
          current = await runTranscriptIO(() => validate(signal), signal)
        if (
          !actual.isFile() ||
          !same(actual, expected) ||
          !same(actual, current) ||
          current.path !== expected.path
        ) {
          unsafe()
        }
        return handle
      } catch (error) {
        await awaitTranscriptIO(handle.close(), signal).catch(() => {})
        throw error
      }
    },
  }
}
