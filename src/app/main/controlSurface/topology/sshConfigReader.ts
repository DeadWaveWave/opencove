import { glob } from 'node:fs'
import { readFile as readNodeFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { parseSshConfig } from '../../../../contexts/topology/domain/sshConfigParse'
import type { SshConfigHost } from '../../../../shared/contracts/dto'

const MAX_FILE_BYTES = 1024 * 1024
const MAX_GLOB_MATCHES = 256
const MAX_TOTAL_BYTES = 8 * 1024 * 1024
const READ_WARNING = 'Unable to read an SSH configuration file; skipping it.'

type ReadFile = (filePath: string) => Promise<string>

export type ReadSshConfigHostsOptions = {
  configPath?: string
  homeDirectory?: string
  warn?: (message: string) => void
  readFile?: ReadFile
}

type ExpansionContext = {
  cache: Map<string, string>
  homeDirectory: string
  rootDirectory: string
  seenFiles: Set<string>
  totalBytes: number
  warn: (message: string) => void
  readFile: ReadFile
}

export async function readSshConfigHosts(
  options: ReadSshConfigHostsOptions = {},
): Promise<SshConfigHost[]> {
  const homeDirectory = options.homeDirectory ?? homedir()
  const configPath = options.configPath ?? join(homeDirectory, '.ssh', 'config')
  const context: ExpansionContext = {
    cache: new Map(),
    homeDirectory,
    rootDirectory: dirname(configPath),
    seenFiles: new Set(),
    totalBytes: 0,
    warn: options.warn ?? writeWarning,
    readFile: options.readFile ?? (async filePath => await readNodeFile(filePath, 'utf8')),
  }

  try {
    const lines = await expandFile(configPath, context, [])
    return parseSshConfig(lines.join('\n'))
  } catch {
    context.warn('Unable to parse SSH configuration; returning no hosts.')
    return []
  }
}

async function expandFile(
  filePath: string,
  context: ExpansionContext,
  activeStack: readonly string[],
): Promise<string[]> {
  const canonicalPath = await canonicalize(filePath, context)
  if (!canonicalPath || activeStack.includes(canonicalPath)) {
    return []
  }

  const content = await readSafeFile(canonicalPath, context)
  if (content === null) {
    return []
  }

  const expanded: string[] = []
  const nextStack = [...activeStack, canonicalPath]
  for (const line of content.split(/\r?\n/)) {
    const includePatterns = parseIncludePatterns(line)
    if (!includePatterns) {
      expanded.push(line)
      continue
    }

    for (const includePattern of includePatterns) {
      // eslint-disable-next-line no-await-in-loop -- bounded sequential expansion preserves OpenSSH Include order
      const matches = await resolveIncludePaths(includePattern, context)
      for (const matchedPath of matches) {
        // eslint-disable-next-line no-await-in-loop -- sequential reads avoid a user-controlled 256-way IO burst
        appendLines(expanded, await expandFile(matchedPath, context, nextStack))
      }
    }
  }
  return expanded
}

async function readSafeFile(
  canonicalPath: string,
  context: ExpansionContext,
): Promise<string | null> {
  const cached = context.cache.get(canonicalPath)
  if (cached !== undefined) {
    return cached
  }

  try {
    const fileStats = await stat(canonicalPath)
    if (!fileStats.isFile() || fileStats.size > MAX_FILE_BYTES) {
      context.warn(
        'SSH configuration file is not a readable file within the size limit; skipping it.',
      )
      return null
    }
    if (!context.seenFiles.has(canonicalPath)) {
      if (context.totalBytes + fileStats.size > MAX_TOTAL_BYTES) {
        context.warn('SSH configuration total size limit reached; skipping remaining files.')
        return null
      }
      context.seenFiles.add(canonicalPath)
      context.totalBytes += fileStats.size
    }

    const content = await context.readFile(canonicalPath)
    context.cache.set(canonicalPath, content)
    return content
  } catch {
    context.warn(READ_WARNING)
    return null
  }
}

function parseIncludePatterns(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }
  const match = trimmed.match(/^([^=\s]+)(?:\s*=\s*|\s+)(.*)$/)
  if (!match || match[1].toLowerCase() !== 'include') {
    return null
  }
  const patterns = splitArguments(match[2])
  return patterns.length > 0 ? patterns : null
}

async function resolveIncludePaths(pattern: string, context: ExpansionContext): Promise<string[]> {
  const absolutePattern = resolveIncludePattern(pattern, context)
  if (!hasGlobPattern(absolutePattern)) {
    return [absolutePattern]
  }

  try {
    const matches = (await globPaths(absolutePattern)).sort((left, right) =>
      left.localeCompare(right),
    )
    if (matches.length > MAX_GLOB_MATCHES) {
      context.warn('SSH Include matched too many files; processing only the safe limit.')
    }
    return matches.slice(0, MAX_GLOB_MATCHES)
  } catch {
    context.warn('Unable to expand an SSH Include pattern; skipping it.')
    return []
  }
}

function resolveIncludePattern(pattern: string, context: ExpansionContext): string {
  if (pattern === '~') {
    return context.homeDirectory
  }
  if (pattern.startsWith('~/') || pattern.startsWith('~\\')) {
    return join(context.homeDirectory, pattern.slice(2))
  }
  if (isAbsolute(pattern)) {
    return normalize(pattern)
  }
  return normalize(join(context.rootDirectory, pattern))
}

function globPaths(pattern: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    glob(pattern, (error, matches) => {
      if (error) {
        reject(error)
      } else {
        resolve(matches)
      }
    })
  })
}

async function canonicalize(filePath: string, context: ExpansionContext): Promise<string | null> {
  try {
    return await realpath(filePath)
  } catch (error) {
    if (!isMissingFileError(error)) {
      context.warn(READ_WARNING)
    }
    return null
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

function hasGlobPattern(pattern: string): boolean {
  return /[*?[]/.test(pattern)
}

function splitArguments(input: string): string[] {
  const values: string[] = []
  let current = ''
  let quoted = false
  for (const character of input) {
    if (character === '"') {
      quoted = !quoted
    } else if (!quoted && character === '#') {
      break
    } else if (!quoted && /\s/.test(character)) {
      if (current) {
        values.push(current)
        current = ''
      }
    } else {
      current += character
    }
  }
  if (current) {
    values.push(current)
  }
  return values
}

function appendLines(target: string[], lines: readonly string[]): void {
  for (const line of lines) {
    target.push(line)
  }
}

function writeWarning(message: string): void {
  try {
    process.stderr.write(`[opencove-ssh-config] ${message}\n`)
  } catch {
    // Diagnostics must not turn a fail-closed reader branch into a Query failure.
  }
}
