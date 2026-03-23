import { useMemo } from 'react'

export function useWorkspaceCanvasTaskTagOptions(taskTagOptions: string[] | undefined): string[] {
  return useMemo(() => {
    const fromSettings = taskTagOptions ?? []
    return [...new Set(fromSettings.map(tag => tag.trim()).filter(tag => tag.length > 0))]
  }, [taskTagOptions])
}
