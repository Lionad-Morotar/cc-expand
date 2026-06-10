import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    teardownTimeout: 5000,
    reporters: ['default', 'hanging-process'],
  },
})
