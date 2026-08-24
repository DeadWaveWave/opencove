import type {
  AgentLaunchPlan,
  AgentProviderDetector,
  CreateAgentLaunchPlanCommand,
} from '../../../application/ports/AgentProviderContribution'
import {
  TerminalCliAgentProviderContribution,
  type TerminalCliAgentProviderOptions,
} from '../terminal-cli/TerminalCliContribution'

const piLaunch = {
  defaultArguments: [],
  defaultEnvironment: {},
  executable: 'pi',
} as const

export class PiAgentProviderContribution extends TerminalCliAgentProviderContribution {
  readonly descriptor = {
    displayName: 'Pi',
    documentationUrl: 'https://pi.dev',
    id: 'pi',
    launch: piLaunch,
  } as const

  constructor(options: { readonly detector?: AgentProviderDetector } = {}) {
    super('pi', piLaunch.executable, options satisfies TerminalCliAgentProviderOptions)
  }

  protected override async createTerminalLaunchPlan(
    command: CreateAgentLaunchPlanCommand,
  ): Promise<AgentLaunchPlan> {
    const model = normalizeOptionalValue(command.model)
    const resumeSessionId = normalizeOptionalValue(command.resumeSessionId)
    const args: string[] = []

    if (model) {
      args.push('--model', model)
    }
    if (command.mode === 'resume') {
      args.push(resumeSessionId ? '--session' : '--continue')
      if (resumeSessionId) {
        args.push(resumeSessionId)
      }
    } else {
      const prompt = command.prompt?.trim() ?? ''
      if (prompt.length > 0) {
        args.push(prompt)
      }
    }

    return {
      args,
      command: piLaunch.executable,
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
