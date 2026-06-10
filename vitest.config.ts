import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    teardownTimeout: 5000,
    reporters: ['default', 'hanging-process'],
  },
})
