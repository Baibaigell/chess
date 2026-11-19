import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // tsconfig 里已声明 "types": ["vitest/globals"]，这里同步打开才能用全局 describe/it/expect
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
