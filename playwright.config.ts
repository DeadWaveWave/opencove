import { defineConfig } from '@playwright/test'

// E2E 默认使用后台窗口模式，避免抢占焦点/干扰本地开发。
// 可通过 OPENCOVE_E2E_WINDOW_MODE 覆盖：inactive / offscreen / hidden。
type E2EWindowMode = 'inactive' | 'offscreen' | 'hidden'

function resolveE2EWindowMode(rawValue: string | undefined): E2EWindowMode {
  const normalized = rawValue?.trim().toLowerCase()
  if (normalized === 'normal') {
    throw new Error(
      '[e2e] OPENCOVE_E2E_WINDOW_MODE=normal is not allowed because it steals OS focus. Use offscreen/inactive/hidden instead.',
    )
  }

  if (normalized === 'inactive' || normalized === 'offscreen' || normalized === 'hidden') {
    return normalized
  }

  return 'offscreen'
}

process.env['OPENCOVE_E2E_WINDOW_MODE'] = resolveE2EWindowMode(
  process.env['OPENCOVE_E2E_WINDOW_MODE'],
)

function resolveConfiguredTestMatch(): string | string[] | undefined {
  const rawValue = process.env['OPENCOVE_E2E_TEST_MATCH']?.trim()
  if (!rawValue) {
    return undefined
  }

  const patterns = rawValue
    .split(/[\n,]+/g)
    .map(pattern => pattern.trim())
    .filter(pattern => pattern.length > 0)

  if (patterns.length <= 1) {
    return patterns[0]
  }

  return patterns
}

const configuredTestMatch = resolveConfiguredTestMatch()
const isCi = process.env.CI === '1' || process.env.CI === 'true'

function resolveE2ERetries(rawValue: string | undefined): number {
  const normalized = rawValue?.trim()
  if (normalized) {
    const parsed = Number(normalized)
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed
    }
  }

  // Required continuity gates never hide deterministic failures behind retries.
  return 0
}

/**
 * Playwright 配置 - Electron E2E 测试
 *
 * 使用 Electron 的 Playwright 集成来测试桌面应用。
 * 运行: npm run test:e2e
 */
export default defineConfig({
  // 测试目录
  testDir: './tests/e2e',

  // 测试文件匹配模式
  testMatch:
    configuredTestMatch && (Array.isArray(configuredTestMatch) || configuredTestMatch.length > 0)
      ? configuredTestMatch
      : '**/*.spec.ts',

  // 全局超时：每个测试 120 秒 (考虑 Electron 启动时间)
  timeout: 120_000,

  // expect 超时
  expect: {
    timeout: 15_000,
  },

  retries: resolveE2ERetries(process.env.OPENCOVE_E2E_RETRIES),

  // 并行 worker 数量
  workers: 1, // Electron 测试建议串行运行

  // 报告器
  reporter: isCi
    ? [['list']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  // 输出目录（截图、视频等）
  outputDir: './test-results',

  // 全局设置/清理
  globalSetup: undefined,
  globalTeardown: undefined,

  // 项目配置
  projects: [
    {
      name: 'electron',
      use: {
        // 截图配置
        screenshot: 'only-on-failure',
        // Required gates do not retry; retain the first failure trace without recording CI video.
        video: isCi ? 'off' : 'retain-on-failure',
        trace: 'retain-on-failure',
      },
    },
  ],
})
