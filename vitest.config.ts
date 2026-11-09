import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/worker.ts',
        'src/generated/**',
        'src/**/*.spec.ts',
      ],
    },
  },
  // SWC emits decorator metadata, which Nest's dependency injection needs.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
