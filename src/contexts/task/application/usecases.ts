import type { SuggestTaskTitleInput, SuggestTaskTitleResult } from '@shared/contracts/dto'
import type { TaskTitlePort } from './ports'

export async function suggestTaskTitleUseCase(
  port: TaskTitlePort,
  input: SuggestTaskTitleInput,
): Promise<SuggestTaskTitleResult> {
  return await port.suggestTitle(input)
}
