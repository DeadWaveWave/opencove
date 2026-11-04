// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const STYLES = resolve(__dirname, '../../../src/app/renderer/styles')
const TRANSLUCENT = ['glass', 'acrylic']
const REDUCED = "[data-cove-transparency='reduced']"

function rulesOf(file: string): Rule[] {
  const rules: Rule[] = []
  postcss.parse(readFileSync(resolve(STYLES, file), 'utf8')).walkRules(rule => {
    rules.push(rule)
  })
  return rules
}

function declarationsOf(rule: Rule): Record<string, string> {
  return Object.fromEntries(
    rule.nodes.flatMap(node =>
      node.type === 'decl'
        ? [[node.prop, node.important ? `${node.value} !important` : node.value]]
        : [],
    ),
  )
}

/** Attribute and pseudo-class count of a `:root[…][…]` selector, which is all these rules use. */
function rootSpecificity(selector: string): number {
  return (selector.match(/\[[^\]]+\]/g)?.length ?? 0) + (selector.startsWith(':root') ? 1 : 0)
}

describe('surface materials', () => {
  it('turn every translucent material solid when transparency is reduced', () => {
    const rules = rulesOf('ui-surface.css').filter(rule => rule.selector.includes(REDUCED))
    for (const material of TRANSLUCENT) {
      const rule = rules.find(candidate => candidate.selector.includes(`'${material}'`))
      expect(rule, `${material} has a reduced-transparency rule`).toBeDefined()
      const declarations = declarationsOf(rule!)
      expect(declarations['backdrop-filter']).toBe('none')
      expect(declarations['background']).toBe('var(--cove-window-surface)')
    }
  })
})

describe('reduced transparency', () => {
  const rules = rulesOf('themes/reduced-transparency.css')

  it('makes every generated glass opaque, over the generated family values', () => {
    const generated = rulesOf('themes/generated/cove.css').filter(rule =>
      rule.selector.startsWith(':root'),
    )
    // Glass opacities are the percentages a colour is mixed with `transparent` at.
    const glassTokens = new Set(
      generated
        .flatMap(rule => Object.values(declarationsOf(rule)))
        .flatMap(value => [...value.matchAll(/var\((--cove-glass-[a-z-]+)\),\s*transparent/g)])
        .map(match => match[1]!),
    )
    expect(glassTokens.size).toBeGreaterThan(0)
    const solid = rules.find(
      rule => rule.selector.includes(REDUCED) && rule.selector.startsWith(':root'),
    )
    expect(solid).toBeDefined()
    const declarations = declarationsOf(solid!)
    for (const token of glassTokens) {
      expect(declarations[token], token).toBe('100%')
    }
    const strongest = Math.max(
      ...generated
        .filter(rule => Object.keys(declarationsOf(rule)).some(prop => glassTokens.has(prop)))
        .flatMap(rule => rule.selector.split(',').map(part => rootSpecificity(part.trim()))),
    )
    expect(rootSpecificity(solid!.selector)).toBeGreaterThan(strongest)
  })

  it('removes every backdrop blur, including on pseudo-elements', () => {
    const blurOff = rules.find(
      rule => declarationsOf(rule)['backdrop-filter'] === 'none !important',
    )
    expect(blurOff).toBeDefined()
    const selectors = blurOff!.selector.split(',').map(part => part.trim())
    expect(selectors).toEqual(
      expect.arrayContaining([
        `:root${REDUCED} *`,
        `:root${REDUCED} *::before`,
        `:root${REDUCED} *::after`,
      ]),
    )
    expect(declarationsOf(blurOff!)['-webkit-backdrop-filter']).toBe('none !important')
  })

  it('no longer depends on the media query, which the shell folds into the attribute', () => {
    for (const file of ['ui-surface.css', 'terminal-node.css', 'themes/reduced-transparency.css']) {
      expect(readFileSync(resolve(STYLES, file), 'utf8')).not.toContain(
        'prefers-reduced-transparency',
      )
    }
  })
})
