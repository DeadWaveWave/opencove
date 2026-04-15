import { useCallback } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  resolveAgentModel,
  resolveWorktreeNameSuggestionProvider,
  type AgentSettings,
} from '@contexts/settings/domain/agentSettings'
import { AI_NAMING_FEATURES } from '@shared/featureFlags/aiNaming'
import { toErrorMessage } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'
import { getWorktreeApiMethod, type WorktreeApiClient } from './spaceWorktree.shared'
import type { WorkspaceSpaceState } from '@contexts/workspace/presentation/renderer/types'

export function useSpaceWorktreeSuggestNames({
  space,
  spaceNotes,
  spaceTasks,
  agentSettings,
  workspacePath,
  worktreeApi,
  setIsSuggesting,
  setError,
  setNewBranchName,
}: {
  space: WorkspaceSpaceState | null
  spaceNotes: string
  spaceTasks: Array<{ title: string; requirement: string }>
  agentSettings: AgentSettings
  workspacePath: string
  worktreeApi: WorktreeApiClient | null
  setIsSuggesting: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setNewBranchName: React.Dispatch<React.SetStateAction<string>>
}): () => Promise<void> {
  const { t } = useTranslation()

  return useCallback(async () => {
    if (!AI_NAMING_FEATURES.worktreeNameSuggestion || !space) {
      return
    }

    setIsSuggesting(true)
    setError(null)

    try {
      const provider = resolveWorktreeNameSuggestionProvider(agentSettings.defaultProvider)
      const model = resolveAgentModel(agentSettings, provider)
      const suggestWorktreeNames = getWorktreeApiMethod(worktreeApi, 'suggestNames', t)

      const suggested = await suggestWorktreeNames({
        provider,
        cwd: workspacePath,
        spaceName: space.name,
        spaceNotes: spaceNotes.trim().length > 0 ? spaceNotes.trim() : null,
        tasks: spaceTasks,
        model,
      })

      setNewBranchName(suggested.branchName)
    } catch (suggestError) {
      setError(t('worktree.aiSuggestionFailed', { message: toErrorMessage(suggestError) }))
    } finally {
      setIsSuggesting(false)
    }
  }, [
    agentSettings,
    setError,
    setIsSuggesting,
    setNewBranchName,
    space,
    spaceNotes,
    spaceTasks,
    t,
    worktreeApi,
    workspacePath,
  ])
}
