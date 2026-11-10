import type {
  CanvasNodeFrameDto,
  CreateNodeResult,
} from '../../../shared/contracts/dto/nodeControl'
import type { CommandContext } from '../core/command'

/** Compare only requested components; automatic placement is not an adjustment. */
export function reportNodeFrame(
  value: unknown,
  ctx: Pick<CommandContext, 'options' | 'io'>,
  kind: string,
  always = false,
) {
  const requested = ctx.options.frame as Partial<CanvasNodeFrameDto> | undefined
  if (!requested && !always) {
    return value
  }
  const appliedFrame = (value as CreateNodeResult).node.frame
  const frameAdjusted =
    !!requested &&
    (['x', 'y', 'width', 'height'] as const).some(
      key => requested[key] !== undefined && requested[key] !== appliedFrame[key],
    )
  if (frameAdjusted) {
    ctx.io.stderr.write(
      `Notice: ${kind} frame adjusted; applied frame: ${JSON.stringify(appliedFrame)}.\n`,
    )
  }
  return { ...(value as object), appliedFrame, frameAdjusted }
}
