import type {
  AgentLaunchPlan,
  AgentProviderDetector,
  CreateAgentLaunchPlanCommand,
} from '../../../application/ports/AgentProviderContribution'
import {
  TerminalCliAgentProviderContribution,
  type TerminalCliAgentProviderOptions,
} from '../terminal-cli/TerminalCliContribution'

const kimiLaunch = {
  defaultArguments: [],
  defaultEnvironment: {},
  executable: 'kimi',
} as const

export class KimiAgentProviderContribution extends TerminalCliAgentProviderContribution {
  readonly descriptor = {
    displayName: 'Kimi Code',
    documentationUrl: 'https://moonshotai.github.io/kimi-code/',
    id: 'kimi',
    launch: kimiLaunch,
  } as const

  constructor(options: { readonly detector?: AgentProviderDetector } = {}) {
    super('kimi', kimiLaunch.executable, options satisfies TerminalCliAgentProviderOptions)
  }

  protected override async createTerminalLaunchPlan(
    command: CreateAgentLaunchPlanCommand,
  ): Promise<AgentLaunchPlan> {
    const model = normalizeOptionalValue(command.model)
    const resumeSessionId = normalizeOptionalValue(command.resumeSessionId)
    const prompt = command.prompt?.trim() ?? ''

    if (command.mode === 'new' && prompt.length > 0 && !command.agentFullAccess) {
      throw new Error(
        'Kimi prompt mode requires full access because the CLI forces auto permission.',
      )
    }

    const args: string[] = []
    const interactive = command.mode === 'resume' || prompt.length === 0
    if (interactive && command.agentFullAccess) {
      args.push('--auto')
    }
    if (model) {
      args.push('--model', model)
    }
    if (command.mode === 'resume') {
      args.push(resumeSessionId ? '--session' : '--continue')
      if (resumeSessionId) {
        args.push(resumeSessionId)
      }
    } else if (prompt.length > 0) {
      args.push('--prompt', prompt)
    }

    return {
      args,
      command: kimiLaunch.executable,
      effectiveModel: model,
      env: {},
      launchMode: command.mode,
      resumeSessionId: command.mode === 'resume' ? resumeSessionId : null,
    }
  }
}

function normalizeOptionalValue(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}
