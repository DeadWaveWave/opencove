import type { UpdateSpaceResult } from '../../../shared/contracts/dto/spaceUpdate'
import { defineCommand } from '../core/command'
import { usage } from '../core/errors'
import { declaredOutput } from './declaredOutput'

const frameFields = ['x', 'y', 'width', 'height'] as const

export const spaceUpdateCommand = defineCommand({
  path: ['space', 'update'],
  summary: 'Rename, move or resize a space',
  usage: '--space <selector> [--name <text>] [--frame <json>]',
  description:
    'Rename a space or change its canvas boundary. Names follow the same rules as space create. Supply a name, a frame, or both. Changing x or y moves all member nodes and child spaces by the same distance; changing width or height resizes only the boundary. The boundary expands as needed to keep members inside, and ancestors grow to contain the updated space. appliedFrame and frameAdjusted report changes to requested frame values. Directory and worktree bindings are preserved.',
  connect: true,
  operation: 'space.update',
  options: {
    space: {
      type: 'string',
      valueName: 'selector',
      required: true,
      defaultSelf: false,
      description: 'Select the space to rename or arrange',
    },
    name: {
      type: 'string',
      valueName: 'text',
      description: 'Set a nonblank name; surrounding whitespace is removed',
    },
    frame: {
      type: 'json',
      valueName: 'json',
      description: 'Set any of x, y, width and height; dimensions must be positive',
    },
  },
  render: declaredOutput(
    [
      'id',
      'name',
      'projectId',
      'parentSpaceId',
      'rect',
      ...frameFields.map(key => `rect.${key}`),
      'directoryPath',
      'movedNodeIds',
      'frameAdjusted',
      'appliedFrame',
      ...frameFields.map(key => `appliedFrame.${key}`),
    ],
    { id: 'space-123' },
  ),
  examples: [
    'opencove space update --space @self --name "Review"',
    'opencove space update --space "Review" --frame \'{"width":1200,"height":800}\'',
    'opencove space update --space space-123 --frame \'{"x":100,"y":200}\'',
  ],
  buildInput({ options: o }) {
    if (o.name === undefined && o.frame === undefined) {
      usage('Supply --name or --frame to update the space')
    }
    if (o.name !== undefined && (typeof o.name !== 'string' || !o.name.trim())) {
      usage('--name must not be blank')
    }
    return {
      spaceId: o.space,
      ...(o.name !== undefined ? { name: o.name } : {}),
      ...(o.frame !== undefined ? { frame: o.frame } : {}),
    }
  },
  async execute(ctx) {
    const result = (await ctx.invoke('space.update', ctx.input)) as UpdateSpaceResult
    if (result.frameAdjusted) {
      ctx.io.stderr.write(
        `Notice: space frame adjusted; applied frame: ${JSON.stringify(result.appliedFrame)}.\n`,
      )
    }
    return result
  },
})
