/**
 * Vitest 测试环境设置文件
 *
 * 此文件在每个测试文件运行前自动加载
 */
import '@testing-library/jest-dom/vitest'
import { installMockStorage } from './persistenceTestStorage'

if (typeof window !== 'undefined') {
  const storage = window.localStorage as Partial<Storage> | undefined
  if (
    typeof storage?.getItem !== 'function' ||
    typeof storage.setItem !== 'function' ||
    typeof storage.removeItem !== 'function' ||
    typeof storage.clear !== 'function'
  ) {
    installMockStorage()
  }
}
