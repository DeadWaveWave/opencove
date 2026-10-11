import postcss from 'postcss'

/** Happy DOM drops multiline functional selectors; preserve CSS semantics on one line. */
export function normalizeThemeStylesheet(css: string): string {
  const root = postcss.parse(css)
  root.walkRules(rule => {
    rule.selector = rule.selector.replace(/\s*\n\s*/g, ' ')
  })
  return root.toString()
}
