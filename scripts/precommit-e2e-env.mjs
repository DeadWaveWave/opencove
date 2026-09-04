export function createRequiredE2EEnvironment(baseEnvironment, platform = process.platform) {
  const environment =
    platform === 'win32' && !baseEnvironment['OPENCOVE_E2E_TEST_MATCH']
      ? {
          ...baseEnvironment,
          OPENCOVE_E2E_TEST_MATCH: '**/*.windows.spec.ts',
        }
      : { ...baseEnvironment }

  return {
    ...environment,
    OPENCOVE_E2E_RETRIES: '0',
    OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
  }
}
