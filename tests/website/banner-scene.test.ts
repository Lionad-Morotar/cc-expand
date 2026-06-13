import { describe, it, expect } from 'vitest'
import { createBannerScene } from '../../packages/website/app/banner/banner-scene'

// headless 测试环境下没有 WebGL，因此将 mount 行为从外部观察：
// 只验证 createBannerScene 返回的接口正确且 destroy 幂等。
// 真实渲染行为通过构建产物和视觉回归测试覆盖。
describe('banner-scene lifecycle', () => {
  it('returns a mountable and destroyable scene API', () => {
    const scene = createBannerScene()
    expect(scene).toHaveProperty('mount')
    expect(scene).toHaveProperty('destroy')
    expect(typeof scene.mount).toBe('function')
    expect(typeof scene.destroy).toBe('function')
  })

  it('destroy can be called multiple times without throwing', () => {
    const scene = createBannerScene()
    expect(() => {
      scene.destroy()
      scene.destroy()
    }).not.toThrow()
  })
})
