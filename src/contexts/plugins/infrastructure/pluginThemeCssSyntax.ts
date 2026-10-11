import selectorParser from 'postcss-selector-parser'
import valueParser from 'postcss-value-parser'
import type { AnyNode, Root, Rule } from 'postcss'

export function decodeThemeCss(value: string): string {
  return value.replace(/\\(?:([\da-f]{1,6})\s?|([^\r\n])|\r?\n)/gi, (_, hex, plain) => {
    const point = hex ? Number.parseInt(hex, 16) : 0
    return hex
      ? String.fromCodePoint(point > 0 && point <= 0x10ffff ? point : 0xfffd)
      : (plain ?? '')
  })
}

function insideKeyframes(rule: Rule): boolean {
  let parent: AnyNode | undefined = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && /^(?:-webkit-)?keyframes$/i.test(parent.name)) {
      return true
    }
    parent = parent.parent
  }
  return false
}

/** Selectors are parsed before scoping; commas inside :is() or attributes stay intact. */
export function scopeThemeCss(root: Root, themeId: string): void {
  const scope = `:root[data-cove-theme-id="${themeId}"]`
  root.walkRules(rule => {
    if (insideKeyframes(rule)) {
      return
    }
    if (rule.parent?.type === 'rule') {
      throw new Error('Theme CSS must be bundled with nesting expanded.')
    }
    if (rule.selector.length > 8192) {
      throw new Error('Theme CSS selector exceeds 8 KiB.')
    }
    // Bound functional selector depth before the parser's recursive descent.
    let depth = 0
    let quote = ''
    let escaped = false
    for (const character of rule.selector) {
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (quote) {
        if (character === quote) {
          quote = ''
        }
        continue
      }
      if (character === '"' || character === "'") {
        quote = character
        continue
      }
      if (character === '(' && ++depth > 32) {
        throw new Error('Theme selector nesting exceeds 32 levels.')
      }
      if (character === ')') {
        depth -= 1
      }
    }
    rule.selector = selectorParser(selectors => {
      selectors.each(selector => {
        if (!selector.nodes.length) {
          throw new Error('Empty theme CSS selector.')
        }
        selector.walkNesting(() => {
          throw new Error('Theme CSS nesting must be expanded.')
        })
        const first = selector.first
        if (
          (first.type === 'pseudo' && first.value === ':root') ||
          (first.type === 'tag' && first.value.toLowerCase() === 'html')
        ) {
          first.replaceWith(
            ...selectorParser()
              .astSync(scope)
              .first.nodes.map(node => node.clone()),
          )
        } else {
          selector.prepend(selectorParser.combinator({ value: ' ' }))
          for (const node of [...selectorParser().astSync(scope).first.nodes].reverse()) {
            selector.prepend(node.clone())
          }
        }
      })
    }).processSync(rule.selector)
  })
}

export function rewriteThemeAnimations(root: Root, prefix: string): void {
  const names = new Map<string, string>()
  root.walkAtRules(/^(?:-webkit-)?keyframes$/i, rule => {
    const parsed = valueParser(rule.params).nodes.filter(
      node => node.type !== 'space' && node.type !== 'comment',
    )
    const name = parsed.length === 1 ? decodeThemeCss(parsed[0].value) : ''
    if (
      !/^[a-z_][a-z0-9_-]*$/i.test(name) ||
      /^(none|initial|inherit|unset|revert|revert-layer|auto|ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|infinite|normal|reverse|alternate|alternate-reverse|forwards|backwards|both|running|paused)$/i.test(
        name,
      )
    ) {
      throw new Error('Theme keyframes need an unambiguous custom animation name.')
    }
    const scoped = `${prefix}-${name}`
    names.set(name, scoped)
    rule.params = scoped
  })
  if (!names.size) {
    return
  }
  root.walkDecls(declaration => {
    const property = decodeThemeCss(declaration.prop).toLowerCase()
    if (!/^(?:-webkit-)?animation(?:-name)?$/.test(property) && !property.startsWith('--')) {
      return
    }
    const value = valueParser(declaration.value)
    value.walk(node => {
      if (
        (node.type === 'word' || node.type === 'string') &&
        names.has(decodeThemeCss(node.value))
      ) {
        node.value = names.get(decodeThemeCss(node.value))!
      }
    })
    declaration.value = value.toString()
  })
}
