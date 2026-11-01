import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['tests/**/*.test.ts', 'frontend/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: [
        'src/services/**',
        'src/utils/**',
        'src/routes/**',
        'src/config/**',
        'src/worker/**',
        'frontend/src/utils/**',
      ],
      exclude: [
        'node_modules/**',
        'dist/**',
        'frontend/dist/**',
        '**/*.test.ts',
        'src/config/devDatabase.ts',
      ],
    },
  },
});
