import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['test/**/*.test.ts', 'src/**/*.test.ts'], globalSetup: ['test/support/global-setup.ts'], testTimeout: 30_000, hookTimeout: 120_000, pool: 'forks', fileParallelism: false },
});
