import type {
  AgentProviderDescriptor,
  AgentProviderDetector,
} from '../../../application/ports/AgentProviderContribution'
import { TerminalCliAgentProviderContribution } from '../terminal-cli/TerminalCliContribution'

export class CatalogTerminalCliProvider extends TerminalCliAgentProviderContribution {
  readonly descriptor: AgentProviderDescriptor

  constructor(
    descriptor: AgentProviderDescriptor,
    options: { readonly detector?: AgentProviderDetector } = {},
  ) {
    super(descriptor.id, options)
    this.descriptor = descriptor
  }
}
