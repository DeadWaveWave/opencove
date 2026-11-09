import type { AgentLaunchMode, TerminalAgentShimProvider } from '../../../../shared/contracts/dto'
import { resolveCodexInvocationArguments } from '../cli/CodexInvocationArguments'

export function resolveTerminalAgentInvocationArguments(
  provider: TerminalAgentShimProvider,
  args: readonly string[],
): { launchMode: AgentLaunchMode; expectedResumeSessionId: string | null } {
  if (provider === 'codex') {
    const resolved = resolveCodexInvocationArguments(args, '.')
    return {
      launchMode: resolved.discoverNewSession ? 'new' : 'resume',
      expectedResumeSessionId: resolved.resumeSessionId,
    }
  }
  const flags = args.slice(0, args.indexOf('--') < 0 ? args.length : args.indexOf('--'))
  const resumeIndex = flags.findIndex(argument => argument === '--resume' || argument === '-r')
  const inline = flags.find(argument => argument.startsWith('--resume='))
  const id = resumeIndex >= 0 ? flags[resumeIndex + 1] : inline?.slice('--resume='.length)
  return {
    launchMode:
      resumeIndex >= 0 || inline || flags.includes('--continue') || flags.includes('-c')
        ? 'resume'
        : 'new',
    expectedResumeSessionId:
      provider === 'claude-code' && id && !id.startsWith('-') ? id.trim() || null : null,
  }
}
