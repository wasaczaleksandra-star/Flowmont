import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
          environment: 'node',
        },
        resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
      },
      {
        test: {
          name: 'db',
          include: ['supabase/tests/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 20000,
        },
      },
    ],
  },
});
