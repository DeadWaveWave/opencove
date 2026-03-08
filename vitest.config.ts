/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'

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

      // 覆盖率目标: 70%
      thresholds: {
        lines: 70,
        branches: 70,
        functions: 70,
        statements: 70,
      },

      // 排除不需要统计覆盖率的文件
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.d.ts',
        '**/*.config.{ts,js}',
        '**/types/**',
        'src/main/**', // Electron 主进程代码通过 E2E 测试覆盖
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
    alias: {
      '@': '/src',
      '@app': '/src/app',
      '@contexts': '/src/contexts',
      '@platform': '/src/platform',
      '@shared': '/src/shared',
    },
  },
})
