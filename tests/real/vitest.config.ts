import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/real/codexHookTrust.spec.ts'],
    maxWorkers: 1,
    testTimeout: 60_000,
  },
})
