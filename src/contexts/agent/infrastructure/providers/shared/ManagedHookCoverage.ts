import type { AgentHookCoverage } from '../../../../../shared/contracts/dto'
import type {
  AgentHookInjectionPlan,
  CreateAgentLaunchPlanCommand,
} from '../../../application/ports/AgentProviderContribution'

/** Prompting can rely only on generated, unmodified hook argv in a managed launch. */
export function managedHookCoverage(
  provider: 'codex' | 'claude-code',
  args: readonly string[],
  hooks: Pick<AgentHookInjectionPlan, 'args' | 'hookCoverage'>,
  command: Pick<
    CreateAgentLaunchPlanCommand,
    'executablePathOverride' | 'model' | 'resumeSessionId'
  >,
): AgentHookCoverage {
  // A custom executable may rewrite argv; keep that uncertainty distinct from missing hooks.
  if (command.executablePathOverride?.trim()) {
    return 'unverified_executable'
  }
  if (hooks.hookCoverage !== 'lifecycle') {
    return hooks.hookCoverage ?? 'none'
  }
  const fallback = provider === 'codex' ? 'notify_only' : 'none'
  // Option-like values cannot be treated as verified model/session positional data.
  if (command.model?.trim().startsWith('-') || command.resumeSessionId?.trim().startsWith('-')) {
    return fallback
  }
  const offset = args.findIndex((_, i) => hooks.args.every((value, j) => args[i + j] === value))
  const terminator = args.indexOf('--')
  if (
    !hooks.args.length ||
    offset < 0 ||
    (terminator >= 0 && terminator < offset + hooks.args.length)
  ) {
    return fallback
  }
  // No application setting currently appends custom argv. Fail closed if a later launch
  // path adds an override after the generated hook block. Prompt text after -- is data.
  const tail = args.slice(offset + hooks.args.length, terminator < 0 ? undefined : terminator)
  if (
    tail.some(
      arg =>
        arg === '--config' ||
        arg.startsWith('--config=') ||
        arg.startsWith('-c') ||
        arg === '--settings' ||
        arg.startsWith('--settings=') ||
        arg === '--setting-sources' ||
        arg.startsWith('--setting-sources='),
    )
  ) {
    return fallback
  }
  return 'lifecycle'
}
