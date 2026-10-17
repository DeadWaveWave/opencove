import type { LabelColor } from '@shared/types/labelColor'

/** Label hues a project tile may wear: yellow and red mean waiting and failure, gray is neutral. */
export const PROJECT_ACCENTS = [
  'blue',
  'purple',
  'green',
  'orange',
] as const satisfies readonly LabelColor[]

export type ProjectAccent = (typeof PROJECT_ACCENTS)[number]

/** Derived from the project id, so a project keeps its colour across reorders without saving it. */
export function resolveProjectAccent(workspaceId: string): ProjectAccent {
  let hash = 0
  for (let index = 0; index < workspaceId.length; index += 1) {
    hash = (Math.imul(hash, 31) + workspaceId.charCodeAt(index)) >>> 0
  }
  return PROJECT_ACCENTS[hash % PROJECT_ACCENTS.length]
}
