import content from './SKILL.md?raw'
import canvas from './topics/canvas.md?raw'
import coordinate from './topics/coordinate.md?raw'
import wait from './topics/wait.md?raw'
import read from './topics/read.md?raw'
import access from './topics/access.md?raw'
import events from './topics/events.md?raw'
import { version } from '../../../../package.json'
import { defineCommand } from '../core/command'
import { usage } from '../core/errors'
import { declaredOutput } from '../commands/declaredOutput'

const topics: Readonly<Record<string, string>> = { canvas, coordinate, wait, read, access, events }

export const skillCommand = defineCommand({
  path: ['skill'],
  connect: false,
  summary: 'Print the agent usage guide bundled with this CLI version',
  description:
    'Print the core guide, or select a topic: canvas, coordinate, wait, read, access, events. All guides are bundled and available offline. -o json returns {version, content}, plus topic when selected; --fields projects those fields.',
  positionals: [{ name: 'topic' }],
  examples: ['opencove skill', 'opencove skill coordinate', 'opencove skill read -o json'],
  render: declaredOutput(['version', 'content', 'topic'], { version }),
  textOutput: result => (result as { content: string }).content,
  validateBeforeConnect({ positionals }) {
    if (positionals[0] !== undefined && !Object.hasOwn(topics, positionals[0])) {
      usage(
        `Unknown skill topic ${JSON.stringify(positionals[0])}. Topics: ${Object.keys(topics).join(', ')}.`,
      )
    }
  },
  async execute({ positionals }) {
    const topic = positionals[0]
    return topic === undefined ? { version, content } : { version, content: topics[topic], topic }
  },
})
