import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{shared,db,server,client}/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    env: { IMAGERY_PROVIDER: 'fixture' },
  },
});
