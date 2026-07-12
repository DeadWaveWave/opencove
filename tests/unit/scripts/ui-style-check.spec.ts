import { describe, expect, it } from 'vitest'
import { checkUiStyleFiles, formatUiStyleViolations } from '../../../scripts/check-ui-styles.mjs'

describe('UI style check script', () => {
  it('accepts declared tokens and ignores comments', () => {
    const violations = checkUiStyleFiles([
      {
        path: 'src/app/renderer/styles/base.css',
        content: ':root { --cove-text: rgb(1, 2, 3); }',
      },
      {
        path: 'src/app/renderer/styles/button.css',
        content: `
          /* rgba(1, 2, 3, 0.4) var(--cove-missing) [data-cove-theme='light'] */
          .button { color: var(--cove-text); }
        `,
      },
    ])

    expect(violations).toEqual([])
  })

  it('reports every undeclared token use with its source location', () => {
    const violations = checkUiStyleFiles([
      {
        path: 'src/app/renderer/styles/button.css',
        content: '.button {\n  color: var(--cove-text-missing);\n}',
      },
    ])

    expect(violations).toEqual([
      expect.objectContaining({
        file: 'src/app/renderer/styles/button.css',
        line: 2,
        column: 10,
        rule: 'undeclared-token',
        message: 'Declare `--cove-text-missing` before using it.',
      }),
    ])
  })

  it('rejects raw colors in components but permits token and theme sources', () => {
    const violations = checkUiStyleFiles([
      {
        path: 'src/app/renderer/styles/base.css',
        content: ":root[data-cove-theme='light'] { --cove-text: #123456; }",
      },
      {
        path: 'src/app/renderer/styles/themes/ember.css',
        content: ":root[data-cove-theme-id='ember'] { --cove-text: rgba(1, 2, 3, 0.9); }",
      },
      {
        path: 'src/app/renderer/styles/button.css',
        content:
          '.button { color: #fff; background: rgb(1, 2, 3); border-color: rgba(1, 2, 3, .4); }',
      },
    ])

    expect(violations.map(violation => violation.rule)).toEqual([
      'raw-color',
      'raw-color',
      'raw-color',
    ])
  })

  it('allows only audited constants in provider protocol files', () => {
    const violations = checkUiStyleFiles([
      {
        path: 'src/app/renderer/styles/workspace-agent-item.css',
        content: `
          .claude { color: rgba(217, 119, 87, 0.96); }
          .new-color { color: rgba(1, 2, 3, 0.5); }
        `,
      },
    ])

    expect(violations).toEqual([
      expect.objectContaining({
        line: 3,
        rule: 'raw-color',
        message: 'Replace raw color `rgba(1, 2, 3, 0.5)` with a declared `--cove-*` token.',
      }),
    ])
  })

  it('rejects component theme branches while allowing centralized branches', () => {
    const violations = checkUiStyleFiles([
      {
        path: 'src/app/renderer/styles/base.css',
        content: ":root[data-cove-theme='light'] { --cove-text: white; }",
      },
      {
        path: 'src/app/renderer/styles/card.css',
        content: ":root[data-cove-theme='light'] .card { color: var(--cove-text); }",
      },
    ])

    expect(violations).toEqual([
      expect.objectContaining({
        file: 'src/app/renderer/styles/card.css',
        line: 1,
        rule: 'component-theme-branch',
      }),
    ])
  })

  it('formats actionable CLI output with path, line, and column', () => {
    const output = formatUiStyleViolations([
      {
        file: 'src/app/renderer/styles/card.css',
        line: 4,
        column: 12,
        rule: 'raw-color',
        message: 'Use a token.',
        excerpt: 'color: #fff;',
      },
    ])

    expect(output).toContain(
      'src/app/renderer/styles/card.css:4:12 [raw-color]\n  Use a token.\n  color: #fff;',
    )
  })
})
