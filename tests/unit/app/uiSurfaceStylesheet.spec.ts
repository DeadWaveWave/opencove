// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const STYLESHEET = resolve(__dirname, '../../../src/app/renderer/styles/ui-surface.css')
const TRANSLUCENT = ['glass', 'acrylic']

function reducedTransparencyRules(): Rule[] {
  const root = postcss.parse(readFileSync(STYLESHEET, 'utf8'))
  const rules: Rule[] = []
  root.walkAtRules('media', media => {
    if (media.params.includes('prefers-reduced-transparency: reduce')) {
      media.walkRules(rule => {
        rules.push(rule)
      })
    }
  })
  return rules
}

describe('surface materials', () => {
  it('turn every translucent material solid when the system reduces transparency', () => {
    const rules = reducedTransparencyRules()
    for (const material of TRANSLUCENT) {
      const rule = rules.find(candidate => candidate.selector.includes(`'${material}'`))
      expect(rule, `${material} has a reduced-transparency rule`).toBeDefined()
      const declarations = Object.fromEntries(
        rule!.nodes.flatMap(node => (node.type === 'decl' ? [[node.prop, node.value]] : [])),
      )
      expect(declarations['backdrop-filter']).toBe('none')
      expect(declarations['background']).toBe('var(--cove-window-surface)')
    }
  })
})
