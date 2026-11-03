import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // One MySQL test database is shared, so test files run one after another.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    setupFiles: ['tests/setup-env.ts', 'tests/teardown.ts'],
    globalSetup: ['tests/global-setup.ts'],
  },
});
