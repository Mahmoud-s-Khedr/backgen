#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const repoRoot = resolve(process.cwd());
const assetsDir = resolve(repoRoot, 'assets/screenshots');
const cliPath = resolve(repoRoot, 'dist/generator/cli.js');
const port = 4173;
const baseUrl = `http://127.0.0.1:${port}`;

mkdirSync(assetsDir, { recursive: true });

async function waitForServer(url, timeoutMs = 30_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${url}/health`);
            if (res.ok) return;
        } catch {
            // continue waiting
        }
        await delay(500);
    }
    throw new Error(`Timed out waiting for ${url}/health`);
}

function runCommand(cmd, args, opts = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(cmd, args, {
            stdio: 'inherit',
            cwd: repoRoot,
            ...opts,
        });
        child.on('exit', (code) => {
            if (code === 0) {
                resolvePromise();
            } else {
                rejectPromise(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`));
            }
        });
        child.on('error', rejectPromise);
    });
}

async function runPlaywrightScreenshot(args) {
    await runCommand('npx', ['--yes', 'playwright', ...args]);
}

async function main() {
    if (!existsSync(cliPath)) {
        throw new Error('Missing dist/generator/cli.js. Run `pnpm run build` first.');
    }

    await runCommand('pnpm', ['--dir', 'packages/playground', 'run', 'build']);

    // Ensure browser is installed for deterministic screenshot capture.
    await runPlaywrightScreenshot(['install', 'chromium']);

    const server = spawn('pnpm', ['--dir', 'packages/playground', 'run', 'start'], {
        cwd: repoRoot,
        env: { ...process.env, PORT: String(port), NODE_ENV: 'production' },
        stdio: 'inherit',
    });

    try {
        await waitForServer(baseUrl);

        await runPlaywrightScreenshot([
            'screenshot',
            '--browser=chromium',
            '--color-scheme=light',
            '--viewport-size=1440,900',
            `${baseUrl}/`,
            `${assetsDir}/playground-light-desktop.png`,
        ]);

        await runPlaywrightScreenshot([
            'screenshot',
            '--browser=chromium',
            '--color-scheme=dark',
            '--viewport-size=1440,900',
            `${baseUrl}/`,
            `${assetsDir}/playground-dark-desktop.png`,
        ]);

        await runPlaywrightScreenshot([
            'screenshot',
            '--browser=chromium',
            '--color-scheme=dark',
            '--viewport-size=390,844',
            `${baseUrl}/`,
            `${assetsDir}/playground-mobile.png`,
        ]);

        console.log('Screenshots captured successfully.');
    } finally {
        server?.kill?.('SIGTERM');
        await delay(1000);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
