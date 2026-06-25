import { defineConfig } from 'tsup'

export default defineConfig([
  // Library bundle
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
  },
  // CLI bundle (separate entry with shebang)
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['cjs'],
    dts: false,
    splitting: false,
    sourcemap: true,
    outDir: 'dist',
    banner: {
      js: '#!/usr/bin/env node',
    },
    // ADR 0003 bundled：子包运行时代码 inline 进 dist（不 external），
    // 避免 dist 运行时解析子包 main(./src/index.ts) 的 .ts 文件（node 不编译 .ts）。
    noExternal: ['@cc-expand/plugin-context-expand'],
    // Don't clean here — library build already cleaned
    clean: false,
  },
])
