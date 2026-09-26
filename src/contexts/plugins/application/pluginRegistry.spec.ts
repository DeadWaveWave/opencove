import { describe, expect, it } from 'vitest'
import { createBuiltinPluginRegistry } from './pluginRegistry'

describe('builtin plugin registry', () => {
  it('exposes Git Board as a stable built in manifest', () => {
    const registry = createBuiltinPluginRegistry()
    expect(registry.get('git-board')).toMatchObject({
      id: 'git-board',
      version: '0.1.0',
      nodeKinds: ['git-board'],
      actionBar: true,
      contextMenu: true,
    })
  })

  it('returns null for unknown plugins instead of inventing a contribution', () => {
    expect(createBuiltinPluginRegistry().get('missing-plugin')).toBeNull()
  })
})
