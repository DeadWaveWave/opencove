export function isDebugCrashHostEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' || typeof process.env.OPENCOVE_TEST_USER_DATA_DIR === 'string'
  )
}
