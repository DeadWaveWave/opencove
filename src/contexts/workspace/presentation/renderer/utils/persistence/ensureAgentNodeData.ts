import type { AgentNodeData } from '../../types'
import { normalizeResumeSessionBinding } from './ensureResumeSessionBinding'
import {
  normalizeProvider,
  normalizeOptionalString,
  normalizeLaunchMode,
  normalizeDirectoryMode,
} from './normalize'

export function ensurePersistedAgentData(value: unknown, owned = false): AgentNodeData | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const provider = normalizeProvider(record.provider)
  const prompt = typeof record.prompt === 'string' ? record.prompt : ''
  const executionDirectory = normalizeOptionalString(record.executionDirectory)

  if (!provider || !executionDirectory) {
    return null
  }

  const resumeBinding =
    owned && provider === 'claude-code'
      ? {
          resumeSessionId:
            typeof record.resumeSessionId === 'string' ? record.resumeSessionId : null,
          resumeSessionIdVerified: record.resumeSessionIdVerified === true,
        }
      : normalizeResumeSessionBinding(provider, record)

  return {
    provider,
    prompt,
    model: normalizeOptionalString(record.model),
    effectiveModel: normalizeOptionalString(record.effectiveModel),
    launchMode: normalizeLaunchMode(record.launchMode),
    ...resumeBinding,
    executionDirectory,
    expectedDirectory: normalizeOptionalString(record.expectedDirectory) ?? executionDirectory,
    directoryMode: normalizeDirectoryMode(record.directoryMode),
    customDirectory: normalizeOptionalString(record.customDirectory),
    shouldCreateDirectory:
      typeof record.shouldCreateDirectory === 'boolean' ? record.shouldCreateDirectory : false,
    taskId: normalizeOptionalString(record.taskId),
  }
}
