import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    pool: 'forks',
    // website 是独立部署产物（GitHub Pages），不属于 npm 包，主包测试不覆盖；
    // zRefs 是调试参考目录（第三方源码），其中的测试不属于本项目
    exclude: [...configDefaults.exclude, 'tests/website/**', 'zRefs/**'],
  },
})
