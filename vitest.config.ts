/// <reference types="vitest/config" />
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { availableParallelism } from 'node:os'
import { defineConfig } from 'vitest/config'

const maxVitestWorkers = Math.max(1, Math.min(4, availableParallelism()))
const reactPath = realpathSync.native(resolve(__dirname, 'node_modules/react'))
const reactDomPath = realpathSync.native(resolve(__dirname, 'node_modules/react-dom'))

export default defineConfig({
  test: {
    // React 测试环境
    environment: 'happy-dom',

    // 全局 API（describe, it, expect 等无需手动导入）
    globals: true,

    esbuild: {
      jsx: 'automatic',
    },

    // 自动加载 setup 文件
    setupFiles: ['./tests/support/vitest.setup.ts'],

    // Cap worker fan-out to avoid flaky fork startup timeouts on local and CI runs.
    maxWorkers: maxVitestWorkers,

    server: {
      deps: {
        inline: [/^react($|\/)/, /^react-dom($|\/)/, /^@testing-library\/react$/],
      },
    },

    deps: {
      optimizer: {
        client: {
          include: ['react', 'react-dom', '@testing-library/react'],
        },
      },
    },

    // 包含的测试文件
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/unit/**/*.{test,spec}.{ts,tsx}',
      'tests/contract/**/*.{test,spec}.{ts,tsx}',
      'tests/integration/**/*.{test,spec}.{ts,tsx}',
    ],

    // 排除目录
    exclude: ['node_modules', 'dist', 'tests/e2e'],

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',

      // 覆盖率目标: keep a modest floor until the suite is expanded.
      thresholds: {
        lines: 50,
        branches: 40,
        functions: 50,
        statements: 50,
      },

      // 排除不需要统计覆盖率的文件
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.d.ts',
        '**/*.config.{ts,js}',
        '**/types/**',
        'src/app/main/**', // Electron 主进程代码通过 E2E 测试覆盖
      ],
    },

    // CSS 处理
    css: {
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
  },

  // 路径别名（与项目 tsconfig 保持一致）
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: reactPath,
      'react-dom': reactDomPath,
      '@xterm/addon-ligatures': resolve(
        __dirname,
        'node_modules/@xterm/addon-ligatures/lib/addon-ligatures.mjs',
      ),
      '@': '/src',
      '@app': '/src/app',
      '@contexts': '/src/contexts',
      '@platform': '/src/platform',
      '@shared': '/src/shared',
    },
  },
})
