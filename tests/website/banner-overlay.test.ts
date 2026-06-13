import { describe, it, expect } from 'vitest'
import { createBannerOverlay } from '../../packages/website/app/banner/banner-overlay'

// headless 测试环境下没有 WebGL，因此将 mount 行为从外部观察：
// 我们只验证 createBannerOverlay 返回的对象接口正确，且 destroy 幂等。
// 真正的渲染行为通过构建产物和视觉回归测试覆盖。
describe('banner-overlay lifecycle', () => {
  it('returns a mountable and destroyable overlay API', () => {
    const overlay = createBannerOverlay()
    expect(overlay).toHaveProperty('mount')
    expect(overlay).toHaveProperty('destroy')
    expect(typeof overlay.mount).toBe('function')
    expect(typeof overlay.destroy).toBe('function')
  })

  it('destroy can be called multiple times without throwing', () => {
    const overlay = createBannerOverlay()
    expect(() => {
      overlay.destroy()
      overlay.destroy()
    }).not.toThrow()
  })
})
