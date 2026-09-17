import { defineConfig } from 'vitest/config';

// Pure-logic tests only (no DOM): node environment keeps this lightweight.
// Component tests would need jsdom + Testing Library (not installed).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
