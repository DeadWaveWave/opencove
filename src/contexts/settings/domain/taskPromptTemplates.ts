import { normalizeTextValue } from './settingsNormalization'

export type TaskPromptTemplate = {
  id: string
  name: string
  content: string
  updatedAt: string
}

export type TaskPromptTemplatesByWorkspaceId = Record<string, TaskPromptTemplate[]>

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const MAX_TASK_PROMPT_TEMPLATE_NAME_LENGTH = 80
const MAX_TASK_PROMPT_TEMPLATE_CONTENT_LENGTH = 20_000
const MAX_TASK_PROMPT_TEMPLATES_PER_SCOPE = 50

function normalizeTaskPromptTemplate(value: unknown): TaskPromptTemplate | null {
  if (!isPlainRecord(value)) {
    return null
  }

  const id = normalizeTextValue(value.id)
  const name = normalizeTextValue(value.name).slice(0, MAX_TASK_PROMPT_TEMPLATE_NAME_LENGTH)
  const content = normalizeTextValue(value.content).slice(
    0,
    MAX_TASK_PROMPT_TEMPLATE_CONTENT_LENGTH,
  )
  const updatedAt = normalizeTextValue(value.updatedAt)

  if (id.length === 0 || name.length === 0 || content.length === 0) {
    return null
  }

  return { id, name, content, updatedAt }
}

function toTemplateNameKey(name: string): string {
  return name.trim().toLowerCase()
}

export function normalizeTaskPromptTemplates(value: unknown): TaskPromptTemplate[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: TaskPromptTemplate[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()

  for (const item of value) {
    const template = normalizeTaskPromptTemplate(item)
    if (!template) {
      continue
    }

    if (seenIds.has(template.id)) {
      continue
    }

    const normalizedNameKey = toTemplateNameKey(template.name)
    if (seenNames.has(normalizedNameKey)) {
      continue
    }

    seenIds.add(template.id)
    seenNames.add(normalizedNameKey)
    normalized.push(template)

    if (normalized.length >= MAX_TASK_PROMPT_TEMPLATES_PER_SCOPE) {
      break
    }
  }

  return normalized
}

export function normalizeTaskPromptTemplatesByWorkspaceId(
  value: unknown,
): TaskPromptTemplatesByWorkspaceId {
  if (!isPlainRecord(value)) {
    return {}
  }

  const normalized: TaskPromptTemplatesByWorkspaceId = {}
  for (const [workspaceId, rawTemplates] of Object.entries(value)) {
    const normalizedWorkspaceId = workspaceId.trim()
    if (normalizedWorkspaceId.length === 0) {
      continue
    }

    const templates = normalizeTaskPromptTemplates(rawTemplates)
    if (templates.length === 0) {
      continue
    }

    normalized[normalizedWorkspaceId] = templates
  }

  return normalized
}
