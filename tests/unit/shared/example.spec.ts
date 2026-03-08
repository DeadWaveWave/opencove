/**
 * 示例单元测试
 *
 * 演示 Vitest 测试框架的基本用法
 */
import { describe, it, expect } from 'vitest'

describe('Example Test Suite', () => {
  it('should pass a basic test', () => {
    expect(1 + 1).toBe(2)
  })

  it('should work with arrays', () => {
    const arr = [1, 2, 3]
    expect(arr).toHaveLength(3)
    expect(arr).toContain(2)
  })

  it('should work with objects', () => {
    const obj = { name: 'Cove', version: '0.1.0' }
    expect(obj).toHaveProperty('name')
    expect(obj.name).toBe('Cove')
  })
})
