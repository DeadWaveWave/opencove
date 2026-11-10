// @vitest-environment node
import { expect, it } from 'vitest'
import { spaceComparisonCommand } from '../../e2e/cli.output.helpers'

it('quotes the literal @self selector in the command used by the list E2E', () => {
  expect(spaceComparisonCommand).toMatch(/--space (["'])@self\1(?:\s|$)/)
})
