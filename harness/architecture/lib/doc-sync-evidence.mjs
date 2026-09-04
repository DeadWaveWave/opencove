export function isContractSyncEvidence(pathname) {
  return (
    pathname === 'docs/architecture/ARCHITECTURE_HARNESS.md' ||
    pathname === 'harness/architecture/check.mjs' ||
    pathname === 'harness/architecture/rules.json' ||
    pathname.startsWith('harness/architecture/lib/') ||
    pathname.startsWith('tests/contract/controlSurface.') ||
    pathname.startsWith('tests/contract/controlSurface/')
  )
}
