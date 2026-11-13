// The variant rules read each variant's literal set from the repository source named in rules.json,
// so a fixture root that is audited with the real config must contain those source files.
export const VARIANT_SOURCE_FILES: Record<string, string> = {
  'src/shared/contracts/dto/agent.ts':
    "export const AGENT_PROVIDER_IDS = ['claude-code', 'codex', 'opencode', 'gemini', 'pi', 'kimi'] as const\n",
  'src/shared/contracts/persistedAppState.ts':
    "export const PERSISTED_WORKSPACE_NODE_KINDS = ['terminal', 'agent', 'task', 'note', 'role', 'image', 'document', 'folder', 'website', 'plugin'] as const\n",
}
