import content from './SKILL.md?raw'
import { version } from '../../../../package.json'
import { defineCommand } from '../core/command'
import { declaredOutput } from '../commands/declaredOutput'

export const skillCommand = defineCommand({
  path: ['skill'],
  connect: false,
  summary: 'Print the agent usage guide bundled with this CLI version',
  description:
    'Prints SKILL.md as plain text without connecting to a Worker. -o json returns {version, content}; --fields projects those fields.',
  examples: ['opencove skill', 'opencove skill -o json'],
  render: declaredOutput(['version', 'content'], { version }),
  textOutput: result => (result as { content: string }).content,
  async execute() {
    return { version, content }
  },
})
