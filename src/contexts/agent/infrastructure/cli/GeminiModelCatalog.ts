import type { AgentModelOption } from '@shared/contracts/dto'

const GEMINI_SETTINGS_SCHEMA_URL =
  'https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json'
const GEMINI_SETTINGS_SCHEMA_TIMEOUT_MS = 2500

const GEMINI_ALIAS_ORDER = ['auto', 'pro', 'flash', 'flash-lite'] as const

const GEMINI_CLI_FALLBACK_MODELS: AgentModelOption[] = [
  {
    id: 'auto',
    displayName: 'auto',
    description: 'Gemini CLI model alias',
    isDefault: true,
  },
  {
    id: 'pro',
    displayName: 'pro',
    description: 'Gemini CLI model alias',
    isDefault: false,
  },
  {
    id: 'flash',
    displayName: 'flash',
    description: 'Gemini CLI model alias',
    isDefault: false,
  },
  {
    id: 'flash-lite',
    displayName: 'flash-lite',
    description: 'Gemini CLI model alias',
    isDefault: false,
  },
  {
    id: 'auto-gemini-3',
    displayName: 'auto-gemini-3',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'auto-gemini-2.5',
    displayName: 'auto-gemini-2.5',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-3.1-pro-preview',
    displayName: 'gemini-3.1-pro-preview',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-3-pro-preview',
    displayName: 'gemini-3-pro-preview',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-3-flash-preview',
    displayName: 'gemini-3-flash-preview',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-2.5-pro',
    displayName: 'gemini-2.5-pro',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-2.5-flash',
    displayName: 'gemini-2.5-flash',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-2.5-flash-lite',
    displayName: 'gemini-2.5-flash-lite',
    description: 'Gemini CLI model',
    isDefault: false,
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function listGeminiCliFallbackModels(): AgentModelOption[] {
  return GEMINI_CLI_FALLBACK_MODELS.map(model => ({ ...model }))
}

async function fetchGeminiCliSettingsSchema(): Promise<unknown> {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable')
  }

  const response = await fetch(GEMINI_SETTINGS_SCHEMA_URL, {
    headers: {
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(GEMINI_SETTINGS_SCHEMA_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Gemini CLI settings schema: ${response.status} ${response.statusText}`,
    )
  }

  return await response.json()
}

function parseGeminiTierWeight(modelId: string): number {
  if (modelId.includes('pro')) {
    return 0
  }

  if (modelId.includes('flash-lite')) {
    return 2
  }

  if (modelId.includes('flash')) {
    return 1
  }

  return 3
}

function parseGeminiVersion(modelId: string): number {
  const match = /^(?:auto-gemini-|gemini-)(\d+(?:\.\d+)?)/.exec(modelId)
  if (!match) {
    return -1
  }

  const version = Number.parseFloat(match[1])
  return Number.isFinite(version) ? version : -1
}

function sortGeminiModelOptions(options: AgentModelOption[]): AgentModelOption[] {
  const aliasIndex = new Map<string, number>(
    GEMINI_ALIAS_ORDER.map((alias, index) => [alias, index]),
  )

  return [...options].sort((left, right) => {
    const leftAlias = aliasIndex.get(left.id)
    const rightAlias = aliasIndex.get(right.id)
    if (leftAlias !== undefined || rightAlias !== undefined) {
      if (leftAlias === undefined) {
        return 1
      }
      if (rightAlias === undefined) {
        return -1
      }
      return leftAlias - rightAlias
    }

    const leftIsAuto = left.id.startsWith('auto-gemini-')
    const rightIsAuto = right.id.startsWith('auto-gemini-')
    if (leftIsAuto !== rightIsAuto) {
      return leftIsAuto ? -1 : 1
    }

    const leftVersion = parseGeminiVersion(left.id)
    const rightVersion = parseGeminiVersion(right.id)
    if (leftVersion !== rightVersion) {
      return rightVersion - leftVersion
    }

    const leftTier = parseGeminiTierWeight(left.id)
    const rightTier = parseGeminiTierWeight(right.id)
    if (leftTier !== rightTier) {
      return leftTier - rightTier
    }

    return left.id.localeCompare(right.id, 'en', { numeric: true })
  })
}

function extractGeminiModelOptionsFromSchema(schema: unknown): AgentModelOption[] {
  if (!isRecord(schema)) {
    return []
  }

  const properties = schema.properties
  if (!isRecord(properties)) {
    return []
  }

  const modelConfigs = properties.modelConfigs
  if (!isRecord(modelConfigs)) {
    return []
  }

  const modelConfigDefaults = modelConfigs.default
  if (!isRecord(modelConfigDefaults)) {
    return []
  }

  const modelDefinitions = modelConfigDefaults.modelDefinitions
  if (!isRecord(modelDefinitions)) {
    return []
  }

  const modelIdResolutions = modelConfigDefaults.modelIdResolutions
  if (!isRecord(modelIdResolutions)) {
    return []
  }

  const modelsById = new Map<string, AgentModelOption>()

  const aliasKeys = Object.keys(modelIdResolutions).filter(modelId => {
    return !modelId.startsWith('gemini-') && !modelId.startsWith('auto-gemini-')
  })

  for (const alias of aliasKeys) {
    modelsById.set(alias, {
      id: alias,
      displayName: alias,
      description: 'Gemini CLI model alias',
      isDefault: alias === 'auto',
    })
  }

  for (const [modelId, definition] of Object.entries(modelDefinitions)) {
    if (!isRecord(definition) || definition.isVisible !== true) {
      continue
    }

    modelsById.set(modelId, {
      id: modelId,
      displayName: typeof definition.displayName === 'string' ? definition.displayName : modelId,
      description:
        typeof definition.dialogDescription === 'string' ? definition.dialogDescription : '',
      isDefault: false,
    })
  }

  const normalized = sortGeminiModelOptions([...modelsById.values()])

  if (normalized.every(model => model.isDefault === false)) {
    const defaultModel = normalized.find(model => model.id === 'auto') ?? normalized[0]
    if (defaultModel) {
      defaultModel.isDefault = true
    }
  }

  return normalized
}

export async function listGeminiCliModelsFromSchema(): Promise<AgentModelOption[]> {
  const schema = await fetchGeminiCliSettingsSchema()
  return extractGeminiModelOptionsFromSchema(schema)
}
