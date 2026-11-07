import { dirname, join, resolve } from 'node:path'
import { resolveHomeDirectoryCandidates } from '../../../platform/os/HomeDirectory'

export function encodeClaudeProjectPath(cwd: string): string {
  return resolve(cwd).replace(/[^A-Za-z0-9]/g, '-')
}

function encodeSlashOnlyClaudeProjectPath(cwd: string): string {
  return resolve(cwd).replace(/[:\\/]/g, '-')
}

function encodeColonlessClaudeProjectPath(cwd: string): string {
  return resolve(cwd).replace(/[\\/]/g, '-').replace(/:/g, '')
}

function resolveClaudeProjectPathEncodings(cwd: string): string[] {
  return [
    ...new Set([
      encodeClaudeProjectPath(cwd),
      encodeSlashOnlyClaudeProjectPath(cwd),
      encodeColonlessClaudeProjectPath(cwd),
    ]),
  ]
}

export function resolveClaudeWorkspacePathCandidates(cwd: string): string[] {
  const candidates: string[] = []
  let current = resolve(cwd)

  while (!candidates.includes(current)) {
    candidates.push(current)
    const parent = dirname(current)
    if (parent === current) {
      break
    }

    current = parent
  }

  return candidates
}

/**
 * Claude Code keeps its state under CLAUDE_CONFIG_DIR when set, otherwise under ~/.claude.
 * OpenCove-launched agents inherit the Worker environment, so the Worker's value is the one
 * the agent wrote its transcripts with.
 */
export function resolveClaudeConfigDirectoryCandidates(
  homeDirectories = resolveHomeDirectoryCandidates(),
  configDirectory = process.env.CLAUDE_CONFIG_DIR,
): string[] {
  const explicit = configDirectory?.trim() ? [resolve(configDirectory.trim())] : []
  return [...new Set([...explicit, ...homeDirectories.map(home => join(home, '.claude'))])]
}

export function resolveClaudeProjectDirectoryCandidateGroups(
  cwd: string,
  homeDirectories = resolveHomeDirectoryCandidates(),
  configDirectory = process.env.CLAUDE_CONFIG_DIR,
): string[][] {
  const configDirectories = resolveClaudeConfigDirectoryCandidates(homeDirectories, configDirectory)
  return resolveClaudeWorkspacePathCandidates(cwd).map(workspacePath => {
    const encodedPaths = resolveClaudeProjectPathEncodings(workspacePath)

    return encodedPaths.flatMap(encodedPath =>
      configDirectories.map(configRoot => join(configRoot, 'projects', encodedPath)),
    )
  })
}
