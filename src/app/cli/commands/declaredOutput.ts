import { shellWord } from '../core/shellWord'
import type { RenderSpec } from '../core/command'

/** Declare result fields and a matching help example without inspecting runtime data. */
export function declaredOutput(
  fields: string[],
  example: unknown,
  shape: Pick<RenderSpec, 'itemKey' | 'listKey' | 'itemAtRoot'> = {},
): RenderSpec {
  return {
    ...shape,
    fields,
    examples: [`--fields ${shellWord(fields[0])}`, JSON.stringify(example)],
  }
}

export const noResultOutput: RenderSpec = {
  unavailable: 'This command returns no result fields. Omit --fields.',
}
