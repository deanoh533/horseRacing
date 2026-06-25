import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts', 'client/src/lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/engine/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@kra': path.resolve(__dirname, './src/kra'),
      '@db': path.resolve(__dirname, './src/db'),
      '@engine': path.resolve(__dirname, './src/engine'),
      '@ai': path.resolve(__dirname, './src/ai'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@types': path.resolve(__dirname, './src/types'),
      '@app-types': path.resolve(__dirname, './src/types'),
    },
  },
});
