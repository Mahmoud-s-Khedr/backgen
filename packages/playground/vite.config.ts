import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite plugin to polyfill Node.js modules used by @mrleebo/prisma-ast and ejs.
 * These libraries import os, fs, path but only use a small subset in the browser path.
 */
function nodePolyfills(): Plugin {
    return {
        name: 'node-polyfills',
        enforce: 'pre',
        resolveId(id) {
            if (id === 'os') return '\0polyfill:os';
            if (id === 'fs') return '\0polyfill:fs';
            if (id === 'path') return '\0polyfill:path';
            if (id === 'lilconfig') return '\0polyfill:lilconfig';
            return null;
        },
        load(id) {
            if (id === '\0polyfill:os') return 'export const EOL = "\\n";';
            if (id === '\0polyfill:fs') return 'export function readFileSync() { throw new Error("fs not available in browser"); } export default {};';
            if (id === '\0polyfill:path') return 'export function join(...args) { return args.join("/"); } export function resolve(...args) { return args.join("/"); } export function dirname(p) { return p.split("/").slice(0, -1).join("/"); } export default { join, resolve, dirname };';
            if (id === '\0polyfill:lilconfig') return 'export function lilconfigSync() { return { search: () => null }; }';
            return null;
        },
    };
}

export default defineConfig({
    plugins: [nodePolyfills(), react()],
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
        chunkSizeWarningLimit: 700,
        rollupOptions: {
            output: {
                manualChunks: {
                    monaco: ['@monaco-editor/react'],
                },
            },
        },
    },
});
