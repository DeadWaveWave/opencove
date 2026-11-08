import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { computeHomeDirectoryCandidates } from '../../../../platform/os/HomeDirectory'
import { resolveClaudeConfigDirectoryCandidates } from '../../../../contexts/agent/infrastructure/ClaudeProjectPaths'

/** A complete captured launch environment is the authority, not subsequent Worker env. */
export function claudeTranscriptLaunchRoots(environment: Readonly<NodeJS.ProcessEnv>): string[] {
  if (environment.CLAUDE_CONFIG_DIR?.trim()) {
    return [resolve(environment.CLAUDE_CONFIG_DIR.trim())]
  }
  const homes = computeHomeDirectoryCandidates({
    env: environment,
    platform: process.platform,
    osHomeDir: '',
  })
  return resolveClaudeConfigDirectoryCandidates(homes.length ? homes : [homedir()], '')
}
