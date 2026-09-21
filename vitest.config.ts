import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Unit tests only: pure functions in lib/ and API route handlers with a mocked
 * Supabase client. Nothing here talks to a database or a browser, so the node
 * environment is enough and the suite stays fast enough to run on every save.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
});
