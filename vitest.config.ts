import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Two test files spawn a real `astro build`. Run serially: concurrent
    // builds share the project's .astro content-layer cache and race on it,
    // which fails them in the full suite while each passes on its own.
    fileParallelism: false,
  },
});
