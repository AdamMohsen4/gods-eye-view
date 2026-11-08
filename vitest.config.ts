import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{shared,db,worker,server,client}/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    env: { FIXTURE_MODE: '1' },
  },
});
