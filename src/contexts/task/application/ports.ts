import type { SuggestTaskTitleInput, SuggestTaskTitleResult } from '@shared/contracts/dto'

export interface TaskTitlePort {
  suggestTitle: (input: SuggestTaskTitleInput) => Promise<SuggestTaskTitleResult>
}
