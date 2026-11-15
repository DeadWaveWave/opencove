const MACOS_ONLY_E2E = /^tests\/e2e\/[^/]+\.mac\.spec\.ts$/

// The E2E files the macOS job of every CI run executes: each tracked macOS-only file plus the
// core group of the quick gate. The job selects by name pattern, so a new `*.mac.spec.ts` file
// needs no workflow edit.
export function selectMacosPlatformE2E({ trackedFiles, coreTests }) {
  const selected = new Set(coreTests)
  for (const file of trackedFiles) {
    if (MACOS_ONLY_E2E.test(file)) {
      selected.add(file)
    }
  }
  return [...selected].sort()
}
