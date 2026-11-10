import type { AddProjectResult } from '../../../shared/contracts/dto/workspaceBootstrap'
import { defineCommand } from '../core/command'
import { CliError, usage } from '../core/errors'
import { declaredOutput } from './declaredOutput'

export const projectAddCommand = defineCommand({
  path: ['project', 'add'],
  summary: 'Add a local directory as a project',
  description:
    'The path must be an existing absolute local directory on the Worker. An existing project at the same path is reused with its saved name. Agents cannot add projects: ask the user to add the project in OpenCove.',
  connect: true,
  operation: 'project.add',
  options: {
    path: {
      type: 'string',
      valueName: 'dir',
      description: 'Add this local directory',
      required: true,
    },
    name: {
      type: 'string',
      valueName: 'name',
      description: 'Name a new project; defaults to the directory name',
    },
  },
  render: declaredOutput(
    [
      'id',
      'name',
      'path',
      'defaultSpace',
      'defaultSpace.id',
      'defaultSpace.name',
      'defaultSpace.directoryPath',
      'defaultSpace.rect',
      'defaultSpace.rect.x',
      'defaultSpace.rect.y',
      'defaultSpace.rect.width',
      'defaultSpace.rect.height',
    ],
    { id: 'project-123' },
  ),
  examples: ['opencove project add --path /workspace/app --name "App"'],
  buildInput: ({ options: o }) => {
    if (typeof o.path !== 'string' || !o.path.trim()) {
      usage('--path must not be blank')
    }
    if (o.name !== undefined && !String(o.name).trim()) {
      usage('--name must not be blank')
    }
    return { path: o.path, name: o.name }
  },
  async execute({ invoke, input }) {
    let result: AddProjectResult
    try {
      result = (await invoke('project.add', input)) as AddProjectResult
    } catch (error) {
      if (
        error instanceof CliError &&
        error.code === 'common.forbidden' &&
        (error.details as { reason?: string } | undefined)?.reason === 'operation_denied'
      ) {
        throw new CliError(
          error.code,
          error.exitCode,
          'Adding a project requires a human decision in OpenCove. Agents cannot add projects.',
          'Ask the user to add the project in OpenCove.',
          error.details,
        )
      }
      throw error
    }
    if (!result.project) {
      throw new CliError(
        'cli.result_unavailable',
        1,
        'The project was added, but this Worker did not return its details.',
        'Run "opencove project list" to find it. Do not repeat the add command.',
      )
    }
    const space = result.space
    return {
      ...result.project,
      defaultSpace: space
        ? { id: space.id, name: space.name, directoryPath: space.directoryPath, rect: space.rect }
        : null,
    }
  },
})
