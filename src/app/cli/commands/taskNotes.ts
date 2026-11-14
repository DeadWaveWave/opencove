import { defineCommand, type OptionSpec } from '../core/command'
import { nodeKindOutput } from './outputContracts'
import { declaredOutput } from './declaredOutput'

const selector = (description: string): OptionSpec => ({
  type: 'string',
  selector: 'node',
  valueName: 'selector',
  description,
})
const taskOutput = {
  ...nodeKindOutput('task', false),
  fields: [...nodeKindOutput('task', false).fields!, 'revision', 'changed'],
  projectedEnvelopeFields: ['revision', 'changed'],
}
export const taskNoteCommands = [
  defineCommand({
    path: ['task', 'claim'],
    summary: 'Claim a task for an existing agent',
    description:
      'Defaults to your authenticated agent. With a user credential, supply --agent. You can select your own agent or any agent you started, including their descendants. Task and selected agent must share a project and Space. An existing holder must release the task before another agent can claim it. Claiming does not start an agent.',
    connect: true,
    operation: 'task.claim',
    requireOperationDiscovery: true,
    options: {
      task: { ...selector('Select the task to claim'), required: true },
      agent: selector(
        'Select an existing agent; session grants can select their own agent or agents they started',
      ),
    },
    buildInput: ({ options: o }) => ({
      taskNodeId: o.task,
      ...(o.agent !== undefined ? { agentNodeId: o.agent } : {}),
    }),
    render: taskOutput,
    examples: [
      'opencove task claim --task "Review"',
      'opencove task claim --task task-123 --agent "Reviewer" --pretty',
    ],
  }),
  defineCommand({
    path: ['task', 'release'],
    summary: 'Release a task without stopping its agent',
    description:
      'The current holder, a coordinator that started the holder, or an authenticated user can release a task. Defaults to todo; use ai_done when the work is ready for review, or done when finished. Release preserves task history and does not stop the agent.',
    connect: true,
    operation: 'task.release',
    requireOperationDiscovery: true,
    options: {
      task: { ...selector('Select the task to release'), required: true },
      status: {
        type: 'string',
        valueName: 'todo|ai_done|done',
        choices: ['todo', 'ai_done', 'done'],
        description: 'Set the task status after release; defaults to todo',
      },
    },
    buildInput: ({ options: o }) => ({
      taskNodeId: o.task,
      ...(o.status !== undefined ? { status: o.status } : {}),
    }),
    render: taskOutput,
    examples: ['opencove task release --task "Review" --status ai_done'],
  }),
  defineCommand({
    path: ['note', 'append'],
    summary: 'Append text to a shared note',
    description:
      'Provide exactly one of --text or --text-file; use --text-file - for stdin. Preserves whitespace and separates entries with a blank line. Each append is limited to 64 KiB of UTF-8 text; the resulting note must fit within 1 MiB. Concurrent appends preserve commit order. Repeating a request may duplicate text; inspect the note after an uncertain outcome.',
    connect: true,
    operation: 'note.append',
    requireOperationDiscovery: true,
    options: {
      node: { ...selector('Select a note to append to'), required: true },
      text: {
        type: 'string',
        valueName: 'text',
        required: true,
        fileVariant: true,
        description: 'Append literal text without trimming whitespace',
      },
    },
    buildInput: ({ options: o }) => ({ nodeId: o.node, text: o.text }),
    render: declaredOutput(['revision', 'nodeId', 'appendedBytes', 'totalBytes'], { revision: 2 }),
    examples: [
      'opencove note append --node "Progress" --text "Review complete"',
      'opencove note append --node "Progress" --text-file ./result.txt',
      'opencove note append --node "Progress" --text-file -',
    ],
  }),
]
