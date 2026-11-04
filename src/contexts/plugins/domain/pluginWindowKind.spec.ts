import { describe, expect, it } from 'vitest'
import { normalizeLocalPluginPackage } from './localPluginValidation'

const base = {
  apiVersion: 1,
  id: 'kind-example',
  version: '1.0.0',
  displayName: 'Kind example',
  description: 'Window kind fixture',
}

describe('plugin window kind', () => {
  it('lets a plugin window pick one of the host kind families', () => {
    const pkg = normalizeLocalPluginPackage({
      ...base,
      view: { entry: 'index.html', kind: 'knowledge' },
    })
    expect(pkg.view?.kind).toBe('knowledge')
    expect(normalizeLocalPluginPackage(pkg)).toEqual(pkg)
  })

  it('stays neutral when no kind is declared', () => {
    expect(normalizeLocalPluginPackage({ ...base, view: { entry: 'index.html' } }).view?.kind).toBe(
      undefined,
    )
  })

  it('rejects kinds the host does not colour', () => {
    expect(() =>
      normalizeLocalPluginPackage({ ...base, view: { entry: 'index.html', kind: 'neutral' } }),
    ).toThrow(/view.kind/)
    expect(() =>
      normalizeLocalPluginPackage({ ...base, view: { entry: 'index.html', kind: 'red' } }),
    ).toThrow(/view.kind/)
  })
})
