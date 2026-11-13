// Tests that read these files from disk instead of importing them, so `vitest related` cannot see
// the dependency. A changed file under one of the prefixes brings the tests along. Shared by the
// staged test runner and `pnpm impact`.
export const FILE_READ_DEPENDENTS = [
  {
    // Generated families must replace every literal colour base.css declares.
    prefixes: ['src/app/renderer/styles/base.css', 'src/app/renderer/styles/themes/'],
    tests: ['tests/unit/shared/design/themeTokens.spec.ts'],
  },
]

export function resolveFileReadDependentTests(files) {
  return FILE_READ_DEPENDENTS.filter(({ prefixes }) =>
    files.some(file => prefixes.some(prefix => file.startsWith(prefix))),
  ).flatMap(({ tests }) => tests)
}
