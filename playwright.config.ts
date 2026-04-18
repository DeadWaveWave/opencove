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

  // CI 最多重跑一次，避免把确定性失配拖成更长的失败队列。
  retries: process.env.CI ? 1 : 0,

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
        // CI 只保留重试 trace，避免全量失败视频把 runner 磁盘打满。
        video: isCi ? 'off' : 'retain-on-failure',
        trace: isCi ? 'on-first-retry' : 'retain-on-failure',
      },
    },
  ],
})
