import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
        exclude: ['dist/**', '**/node_modules/**', '**/.git/**'],
    },
});
